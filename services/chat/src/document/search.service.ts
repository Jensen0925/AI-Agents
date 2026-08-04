import {
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentEmbeddingService } from "./embedding.service";

interface RawSimilarityResult {
  content: string;
  score: number | string;
}

export interface DocumentSearchResult {
  content: string;
  score: number;
}

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

      const [queryVector] = await this.embeddingService.embedTexts([
        normalizedQuery,
      ]);
      if (!queryVector) {
        throw new Error("Query embedding was not generated");
      }

      const vectorLiteral = `[${queryVector.join(",")}]`;
      const rows = await this.prisma.$queryRaw<RawSimilarityResult[]>`
        SELECT
          chunks."content",
          1 - (chunks."embedding" <=> ${vectorLiteral}::vector) AS "score"
        FROM "document_chunks" AS chunks
        INNER JOIN "documents" AS documents
          ON documents."id" = chunks."documentId"
        WHERE documents."userId" = ${userId}
        ORDER BY chunks."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${limit}
      `;

      return rows.map((row) => ({
        content: row.content,
        score: Number(row.score),
      }));
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
}
