import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { loadLangchainConfig } from "../config/load-langchain-config";
import { DocumentEmbeddingService } from "./embedding.service";
import {
  bm25Search,
  embeddingRerank,
  hybridSearch,
  type RetrievalResult,
} from "./hybrid-retrieval";

interface RawSimilarityResult {
  id?: string;
  documentId?: string;
  chunkIndex?: number | string;
  content: string;
  score: number | string;
}

export interface DocumentSearchResult {
  /** 文档块主键；检索评测使用它与 golden relevantChunkIds 对齐。 */
  id?: string;
  content: string;
  score: number;
}

/** BM25 关键词召回最多读取的用户文档块数，防止一次请求无界扫描。 */
const BM25_CORPUS_CAP = 500;
const DEFAULT_RETRIEVAL_TIMEOUT_MS = 8_000;

/** 使用 PostgreSQL pgvector 在当前用户的文档块中执行语义检索。 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: DocumentEmbeddingService,
  ) {}

  /**
   * 将查询文本向量化后按余弦距离排序。
   * JOIN documents 并过滤 userId，确保任何结果都来自当前用户拥有的文档。
   */
  async similaritySearch(
    query: string,
    userId: string,
    topK: number,
  ): Promise<DocumentSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException("query must be a non-empty string");
    }
    if (!Number.isFinite(topK) || topK < 1) {
      throw new BadRequestException("topK must be a positive number");
    }

    const limit = Math.min(100, Math.floor(topK));

    try {
      // 没有可检索的文档时直接返回，避免首次聊天为了一个空结果下载本地
      // Xenova 模型。这样新账号可以先正常聊天，上传并处理文档后再启用检索。
      // 某些轻量测试替身只提供 $queryRaw；真实 Prisma 客户端始终有
      // document.findFirst，因此缺少该探测能力时直接执行兼容查询。
      if (typeof this.prisma.document?.findFirst === "function") {
        const documentWithChunks = await this.prisma.document.findFirst({
          where: {
            userId,
            chunks: { some: {} },
          },
          select: { id: true },
        });
        if (!documentWithChunks) {
          return [];
        }
      }

      const [queryVector] = await this.embeddingService.embedTexts([
        normalizedQuery,
      ]);
      if (!queryVector) {
        throw new Error("Query embedding was not generated");
      }

      const vectorLiteral = `[${queryVector.join(",")}]`;
      const rows = await this.prisma.$queryRaw<RawSimilarityResult[]>`
        SELECT
          chunks."id",
          chunks."documentId" AS "documentId",
          chunks."chunkIndex" AS "chunkIndex",
          chunks."content",
          1 - (chunks."embedding" <=> ${vectorLiteral}::vector) AS "score"
        FROM "document_chunks" AS chunks
        INNER JOIN "documents" AS documents
          ON documents."id" = chunks."documentId"
        WHERE documents."userId" = ${userId}
        ORDER BY chunks."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${limit}
      `;

      const { minScore } = loadLangchainConfig().retrieval;

      return rows
        .map((row) => ({
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          content: row.content,
          score: Number(row.score),
        }))
        .filter((row) => Number.isFinite(row.score) && row.score >= minScore);
    } catch (error) {
      // 检索是增强能力，不应阻断核心对话。常见原因包括本地模型尚未
      // 下载、网络不可达或 pgvector 尚未启用；记录日志后按“无上下文”继续。
      this.logger.warn(
        `Semantic retrieval unavailable; continuing without context: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * 主链路检索入口。hybrid 模式先并行执行向量与 BM25 召回，采用 RRF 融合，
   * 再用 embedding 余弦重排；任一路失败或超时都会回退到已有的向量检索结果。
   */
  async search(
    query: string,
    userId: string,
    topK: number,
  ): Promise<DocumentSearchResult[]> {
    let config: ReturnType<typeof loadLangchainConfig>["retrieval"];
    try {
      config = loadLangchainConfig().retrieval;
    } catch (error) {
      this.logger.warn(
        `Retrieval config unavailable; using vector search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.similaritySearch(query, userId, topK);
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
    try {
      return await this.withTimeout(
        this.runSearch(query, userId, topK, config.mode),
        timeoutMs,
      );
    } catch (error) {
      this.logger.warn(
        `Hybrid retrieval unavailable; falling back to vector search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.similaritySearch(query, userId, topK);
    }
  }

  private async runSearch(
    query: string,
    userId: string,
    topK: number,
    mode: "simple" | "hybrid",
  ): Promise<DocumentSearchResult[]> {
    if (mode === "simple") {
      return this.similaritySearch(query, userId, topK);
    }

    const wideK = Math.max(1, Math.floor(topK)) * 3;
    const vectorSearch = async (): Promise<RetrievalResult[]> =>
      this.toRetrievalResults(await this.similaritySearch(query, userId, wideK));
    const keywordSearch = async (): Promise<RetrievalResult[]> =>
      bm25Search(query, await this.fetchUserChunks(userId), wideK);
    const candidates = await hybridSearch(query, vectorSearch, keywordSearch, wideK);
    if (candidates.length === 0) return [];

    const reranked = await embeddingRerank(
      query,
      candidates,
      (texts) => this.embeddingService.embedTexts(texts),
      topK,
    );
    return reranked.map(
      ({ chunkId, documentId: _documentId, chunkIndex: _chunkIndex, ...result }) => ({
        id: chunkId,
        ...result,
      }),
    );
  }

  private async fetchUserChunks(userId: string): Promise<RetrievalResult[]> {
    const rows = await this.prisma.$queryRaw<RawSimilarityResult[]>`
      SELECT
        chunks."id",
        chunks."documentId" AS "documentId",
        chunks."chunkIndex" AS "chunkIndex",
        chunks."content",
        0 AS "score"
      FROM "document_chunks" AS chunks
      INNER JOIN "documents" AS documents
        ON documents."id" = chunks."documentId"
      WHERE documents."userId" = ${userId}
      LIMIT ${BM25_CORPUS_CAP}
    `;

    return rows.flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.documentId !== "string") {
        return [];
      }
      const chunkIndex = Number(row.chunkIndex);
      return [{
        chunkId: row.id,
        documentId: row.documentId,
        content: row.content,
        chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : 0,
        score: 0,
      }];
    });
  }

  private toRetrievalResults(
    results: DocumentSearchResult[],
  ): RetrievalResult[] {
    return results.flatMap((result, index) =>
      result.id
        ? [{
            chunkId: result.id,
            documentId: "unknown",
            content: result.content,
            chunkIndex: index,
            score: result.score,
          }]
        : [],
    );
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`retrieval timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
