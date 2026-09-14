import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { documentChunks, documents } from "../database/schema";
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
  /** 命中片段所属文档，供前端定位来源文档（全局检索面板据此跳转预览）。 */
  documentId?: string;
  /** 片段在所属文档中的序号，用于来源定位与评测对齐。 */
  chunkIndex?: number;
  content: string;
  score: number;
}

export type RetrievalScope =
  | { mode: "all" }
  | { mode: "category"; value: string }
  | { mode: "documents"; ids: string[] };

/**
 * 检索降级回调。
 *
 * 检索失败时返回空数组会让「基础设施故障」与「该用户确实没有相关资料」变得
 * 完全同形——上游会把故障渲染成「知识库没有检索到相关文档」，模型据此产出
 * 事实性错误的结论。因此把降级原因显式回调给上游，由上游决定如何标注。
 */
export type RetrievalDegradedReporter = (reason: string) => void;

/** 一次检索可限定的文档数量上限，防止 IN (...) 条件被撑爆。 */
export const MAX_SCOPE_DOCUMENTS = 50;

/**
 * 校验并归一化外部传入的检索范围。非法结构直接抛 400，
 * 避免下游 scopeCondition 拿到畸形 scope 时抛 TypeError 退化成 500。
 */
export function parseScope(value: unknown): RetrievalScope | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("scope must be an object");
  }

  const mode = (value as { mode?: unknown }).mode;
  if (mode === "all") {
    return { mode: "all" };
  }
  if (mode === "category") {
    const raw = (value as { value?: unknown }).value;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new BadRequestException("scope.value must be a non-empty string");
    }
    return { mode: "category", value: raw.trim().slice(0, 100) };
  }
  if (mode === "documents") {
    const raw = (value as { ids?: unknown }).ids;
    if (!Array.isArray(raw)) {
      throw new BadRequestException("scope.ids must be an array");
    }
    if (raw.length > MAX_SCOPE_DOCUMENTS) {
      throw new BadRequestException(
        `scope.ids must not exceed ${MAX_SCOPE_DOCUMENTS} items`,
      );
    }
    return {
      mode: "documents",
      ids: raw
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim().slice(0, 100)),
    };
  }

  throw new BadRequestException(
    "scope.mode must be one of all, category, documents",
  );
}

/**
 * 将「仅当前用户」过滤与可选的检索范围合并为单一 SQL 条件。
 * - all：仅按 userId 过滤（默认行为）。
 * - category：再限定 documents.category。
 * - documents：再限定 documents.id IN (...)，空列表视为无结果。
 * userId 过滤始终保留，确保不会越权读到其他用户的文档块。
 */
function scopeCondition(scope: RetrievalScope | undefined, userId: string): SQL {
  const userFilter = sql`documents."userId" = ${userId}`;
  if (!scope || scope.mode === "all") {
    return userFilter;
  }
  if (scope.mode === "category") {
    return sql`${userFilter} AND documents."category" = ${scope.value}`;
  }
  // 内部调用路径同样做一次兜底，避免畸形 ids 让 SQL 构造抛异常。
  const ids = Array.isArray(scope.ids)
    ? scope.ids.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) {
    return sql`${userFilter} AND 1 = 0`;
  }
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  return sql`${userFilter} AND documents."id" IN (${idList})`;
}

/** BM25 关键词召回最多读取的用户文档块数，防止一次请求无界扫描。 */
const BM25_CORPUS_CAP = 500;
const DEFAULT_RETRIEVAL_TIMEOUT_MS = 8_000;

/**
 * 取出 `db.execute()` 结果里的数据行。
 *
 * node-postgres 驱动下 `db.execute()` 返回 pg 的 `QueryResult`，行挂在 `.rows`
 * 上而不是裸数组。直接当数组使用会抛 `rows.map is not a function`，并被本文件
 * 的降级逻辑吞成「检索不可用」→ 检索结果恒为空。这里同时兼容数组形态，
 * 便于替换为其它驱动或测试替身。
 */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** 使用 PostgreSQL pgvector 在当前用户的文档块中执行语义检索。 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly database: DatabaseService,
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
    scope?: RetrievalScope,
    onDegraded?: RetrievalDegradedReporter,
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
      const [documentWithChunks] = await this.database.db
        .select({ id: documents.id })
        .from(documents)
        .innerJoin(documentChunks, eq(documentChunks.documentId, documents.id))
        .where(scopeCondition(scope, userId))
        .limit(1);
      if (!documentWithChunks) {
        return [];
      }

      const [queryVector] = await this.embeddingService.embedTexts([
        normalizedQuery,
      ]);
      if (!queryVector) {
        throw new Error("Query embedding was not generated");
      }

      const vectorLiteral = `[${queryVector.join(",")}]`;
      const rows = resultRows<RawSimilarityResult>(
        await this.database.db.execute(
          sql<RawSimilarityResult>`
        SELECT
          chunks."id",
          chunks."documentId" AS "documentId",
          chunks."chunkIndex" AS "chunkIndex",
          chunks."content",
          1 - (chunks."embedding" <=> ${vectorLiteral}::vector) AS "score"
        FROM "document_chunks" AS chunks
        INNER JOIN "documents" AS documents
          ON documents."id" = chunks."documentId"
        WHERE ${scopeCondition(scope, userId)}
        ORDER BY chunks."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${limit}
      `,
        ),
      );

      const { minScore } = loadLangchainConfig().retrieval;

      return rows
        .map((row: RawSimilarityResult) => ({
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          ...(typeof row.documentId === "string"
            ? { documentId: row.documentId }
            : {}),
          ...(row.chunkIndex === undefined || row.chunkIndex === null
            ? {}
            : Number.isFinite(Number(row.chunkIndex))
              ? { chunkIndex: Number(row.chunkIndex) }
              : {}),
          content: row.content,
          score: Number(row.score),
        }))
        .filter((row) => Number.isFinite(row.score) && row.score >= minScore);
    } catch (error) {
      // 检索是增强能力，不应阻断核心对话。常见原因包括本地模型尚未
      // 下载、网络不可达或 pgvector 尚未启用；记录日志后按“无上下文”继续，
      // 但必须通过 onDegraded 把「这是故障而非空结果」告知上游。
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Semantic retrieval unavailable; continuing without context: ${reason}`,
      );
      onDegraded?.(reason);
      return [];
    }
  }

  /**
   * 主链路检索入口。hybrid 模式先并行执行向量与 BM25 召回，采用 RRF 融合，
   * 再用 embedding 余弦重排；任一路失败或超时都会回退到向量检索。
   */
  async search(
    query: string,
    userId: string,
    topK: number,
    scope?: RetrievalScope,
    onDegraded?: RetrievalDegradedReporter,
  ): Promise<DocumentSearchResult[]> {
    let config: ReturnType<typeof loadLangchainConfig>["retrieval"];
    try {
      config = loadLangchainConfig().retrieval;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Retrieval config unavailable; using vector search: ${reason}`,
      );
      onDegraded?.(`retrieval config unavailable: ${reason}`);
      return this.similaritySearch(query, userId, topK, scope, onDegraded);
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
    try {
      return await this.withTimeout(
        this.runSearch(query, userId, topK, config.mode, scope, onDegraded),
        timeoutMs,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Hybrid retrieval unavailable; falling back to vector search: ${reason}`,
      );
      onDegraded?.(`hybrid retrieval failed: ${reason}`);
      return this.similaritySearch(query, userId, topK, scope, onDegraded);
    }
  }

  private async runSearch(
    query: string,
    userId: string,
    topK: number,
    mode: "simple" | "hybrid",
    scope?: RetrievalScope,
    onDegraded?: RetrievalDegradedReporter,
  ): Promise<DocumentSearchResult[]> {
    if (mode === "simple") {
      return this.similaritySearch(query, userId, topK, scope, onDegraded);
    }

    const wideK = Math.max(1, Math.floor(topK)) * 3;
    const vectorSearch = async (): Promise<RetrievalResult[]> =>
      this.toRetrievalResults(
        await this.similaritySearch(query, userId, wideK, scope, onDegraded),
      );
    const keywordSearch = async (): Promise<RetrievalResult[]> =>
      bm25Search(query, await this.fetchUserChunks(userId, scope), wideK);
    const candidates = await hybridSearch(query, vectorSearch, keywordSearch, wideK);
    if (candidates.length === 0) return [];

    const reranked = await embeddingRerank(
      query,
      candidates,
      (texts) => this.embeddingService.embedTexts(texts),
      topK,
    );
    return reranked.map(({ chunkId, documentId, chunkIndex, ...result }) => ({
      id: chunkId,
      ...(typeof documentId === "string" ? { documentId } : {}),
      ...(Number.isFinite(chunkIndex) ? { chunkIndex } : {}),
      ...result,
    }));
  }

  private async fetchUserChunks(
    userId: string,
    scope?: RetrievalScope,
  ): Promise<RetrievalResult[]> {
    // ORDER BY 必须确定：只写 LIMIT 会让 PostgreSQL 返回任意行，同一 query
    // 两次请求可能命中不同语料，BM25 结果因而不可复现、评测无法对齐。
    const rows = resultRows<RawSimilarityResult>(
      await this.database.db.execute(
        sql<RawSimilarityResult>`
      SELECT
        chunks."id",
        chunks."documentId" AS "documentId",
        chunks."chunkIndex" AS "chunkIndex",
        chunks."content",
        0 AS "score"
      FROM "document_chunks" AS chunks
      INNER JOIN "documents" AS documents
        ON documents."id" = chunks."documentId"
      WHERE ${scopeCondition(scope, userId)}
      ORDER BY chunks."documentId", chunks."chunkIndex"
      LIMIT ${BM25_CORPUS_CAP}
    `,
      ),
    );

    return rows.flatMap((row: RawSimilarityResult) => {
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

  /**
   * 把向量检索结果转换为融合算法所需的统一结构。
   *
   * documentId / chunkIndex 必须透传真实值：RRF 融合保留的是「向量侧优先」的
   * 结果对象，若这里写死占位值，最终返回给前端的来源信息就会失真
   * （前端无法跳转到来源文档，检索评测也无法与 golden 对齐）。
   */
  private toRetrievalResults(
    results: DocumentSearchResult[],
  ): RetrievalResult[] {
    return results.flatMap((result, index) =>
      result.id
        ? [{
            chunkId: result.id,
            documentId: result.documentId ?? "unknown",
            content: result.content,
            chunkIndex: result.chunkIndex ?? index,
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
