import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { TaskStatus, type Document } from "@prisma/client";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
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
    private readonly prisma: PrismaService,
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
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!document) {
      throw new NotFoundException("Document not found");
    }
    if (!document.filePath) {
      throw new BadRequestException("Document has no local file");
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: "processing", chunkCount: 0 },
    });
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

      const completedDocument = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.documentChunk.deleteMany({
            where: { documentId: document.id },
          });

          // Prisma 将 pgvector 声明为 Unsupported，因此使用参数化原生 SQL 写入。
          for (let index = 0; index < chunks.length; index += 1) {
            const vector = vectors[index];
            if (!vector || vector.length === 0) {
              throw new Error(`Missing embedding for chunk ${index}`);
            }

            const vectorLiteral = `[${vector.join(",")}]`;
            await transaction.$executeRaw`
              INSERT INTO "document_chunks"
                ("id", "documentId", "content", "chunkIndex", "embedding")
              VALUES
                (${randomUUID()}, ${document.id}, ${chunks[index]}, ${index}, ${vectorLiteral}::vector)
            `;
          }

          return transaction.document.update({
            where: { id: document.id },
            data: { status: "done", chunkCount: chunks.length },
          });
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
      await this.prisma.document
        .update({
          where: { id: document.id },
          data: { status: "error", chunkCount: 0 },
        })
        .catch(() => undefined);
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
