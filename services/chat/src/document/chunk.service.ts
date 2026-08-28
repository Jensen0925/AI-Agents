import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { and, eq } from "drizzle-orm";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { DatabaseService } from "../database/database.service";
import {
  documentChunks,
  documents,
  type Document,
  TaskStatus,
} from "../database/schema";
import { type EmitTaskEvent, SseService } from "../sse/sse.service";
import { DocumentEmbeddingService } from "./embedding.service";
import { extractText } from "./parsers/parser.factory";

function resolveServiceRoot(): string {
  const monorepoServiceRoot = resolve(process.cwd(), "services/chat");
  return existsSync(join(monorepoServiceRoot, "package.json"))
    ? monorepoServiceRoot
    : process.cwd();
}

/**
 * 执行文档处理流水线：解析文本、切分、生成向量并持久化文档块。
 * 文档状态在 processing、done 和 error 之间收敛，便于异步接口查询进度。
 */
@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name);
  private readonly serviceRoot = resolveServiceRoot();
  private readonly uploadRoot = resolve(
    process.env["UPLOAD_DIR"] ?? join(this.serviceRoot, "uploads"),
  );
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  constructor(
    private readonly database: DatabaseService,
    private readonly embeddingService: DocumentEmbeddingService,
    private readonly sseService: SseService,
  ) {}

  /**
   * 处理用户拥有的指定文档。
   * 分块与向量必须一一对应，最终在同一事务中替换旧分块并更新文档状态。
   */
  async processDocument(
    documentId: string,
    userId: string,
  ): Promise<Document> {
    const [document] = await this.database.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1);
    if (!document) {
      throw new NotFoundException("Document not found");
    }
    if (!document.filePath) {
      throw new BadRequestException("Document has no local file");
    }

    await this.database.db
      .update(documents)
      .set({ status: "processing", chunkCount: 0 })
      .where(eq(documents.id, document.id));
    await this.emitTaskEvent(userId, {
      taskType: "document_processing",
      taskId: document.id,
      status: TaskStatus.processing,
      message: "Document processing started",
      metadata: { filename: document.filename },
    });

    try {
      const filePath = this.resolveStoredPath(document.filePath);
      const content = (await extractText(filePath, document.mimeType)).trim();
      if (!content) {
        throw new Error("Document contains no extractable text");
      }

      const chunks = (await this.splitter.splitText(content))
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      if (chunks.length === 0) {
        throw new Error("Document produced no text chunks");
      }

      const vectors = await this.embeddingService.embedTexts(chunks);
      if (vectors.length !== chunks.length) {
        throw new Error("Embedding count does not match chunk count");
      }

      const completedDocument = await this.database.db.transaction(
        async (transaction) => {
          await transaction
            .delete(documentChunks)
            .where(eq(documentChunks.documentId, document.id));

          const chunkRows = chunks.map((content, index) => {
            const embedding = vectors[index];
            if (!embedding || embedding.length === 0) {
              throw new Error(`Missing embedding for chunk ${index}`);
            }
            return {
              id: randomUUID(),
              documentId: document.id,
              content,
              chunkIndex: index,
              embedding,
            };
          });
          await transaction.insert(documentChunks).values(chunkRows);

          const [updated] = await transaction
            .update(documents)
            .set({ status: "done", chunkCount: chunks.length })
            .where(eq(documents.id, document.id))
            .returning();
          return updated!;
        },
      );
      await this.emitTaskEvent(userId, {
        taskType: "document_processing",
        taskId: document.id,
        status: TaskStatus.done,
        message: "Document processing completed",
        metadata: {
          filename: document.filename,
          chunkCount: chunks.length,
        },
      });
      return completedDocument;
    } catch (error) {
      try {
        await this.database.db
          .update(documents)
          .set({ status: "error", chunkCount: 0 })
          .where(eq(documents.id, document.id));
      } catch {}
      const errorMessage =
        error instanceof Error ? error.message : "Document processing failed";
      await this.emitTaskEvent(userId, {
        taskType: "document_processing",
        taskId: document.id,
        status: TaskStatus.error,
        message: errorMessage,
        metadata: { filename: document.filename },
      });
      throw error;
    }
  }

  /** 任务通知失败只记录日志，不改变文档处理事务的最终状态。 */
  private async emitTaskEvent(
    userId: string,
    event: EmitTaskEvent,
  ): Promise<void> {
    try {
      await this.sseService.emit(userId, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to emit task event ${event.taskId}/${event.status}: ${message}`,
      );
    }
  }

  /**
   * 将数据库中的相对路径还原为绝对路径，并阻止访问 uploads 目录之外的文件。
   */
  private resolveStoredPath(filePath: string): string {
    const absolutePath = isAbsolute(filePath)
      ? resolve(filePath)
      : filePath === "uploads" || filePath.startsWith(`uploads${sep}`)
        ? resolve(this.uploadRoot, filePath === "uploads" ? "" : filePath.slice(`uploads${sep}`.length))
        : resolve(this.serviceRoot, filePath);
    if (
      absolutePath !== this.uploadRoot &&
      !absolutePath.startsWith(`${this.uploadRoot}${sep}`)
    ) {
      throw new BadRequestException("Stored document path is outside uploads");
    }

    return absolutePath;
  }
}
