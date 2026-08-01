import type { Document } from "@prisma/client";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { existsSync } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { ChunkService } from "./chunk.service";

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function resolveServiceRoot(): string {
  const monorepoServiceRoot = resolve(process.cwd(), "services/chat");
  if (existsSync(join(monorepoServiceRoot, "package.json"))) {
    return monorepoServiceRoot;
  }

  return process.cwd();
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = basename(value.trim())
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);

  return sanitized || fallback;
}

/**
 * 管理上传文档的文件与元数据生命周期。
 * 文件系统操作被限制在 uploads 目录内，记录查询始终携带 userId 做权限隔离。
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly serviceRoot = resolveServiceRoot();
  private readonly uploadRoot = resolve(
    process.env["UPLOAD_DIR"] ?? join(this.serviceRoot, "uploads"),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
  ) {}

  /**
   * 校验并保存内存中的上传文件，然后创建 pending 状态的数据库记录。
   * 元数据写入失败时会回滚已落盘的文件，避免产生无主文件。
   */
  async upload(
    userId: string,
    file: UploadedDocumentFile,
    filename: string,
  ): Promise<Document> {
    this.validateFile(file);

    const safeUserId = sanitizePathSegment(userId, "anonymous");
    const safeFilename = sanitizePathSegment(
      filename || file.originalname,
      "document",
    );
    const userDirectory = this.resolveInsideUploadRoot(safeUserId);
    const absolutePath = this.resolveInsideUploadRoot(
      safeUserId,
      `${Date.now()}-${safeFilename}`,
    );
    const storedPath = relative(this.serviceRoot, absolutePath);

    await mkdir(userDirectory, { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: "wx" });

    try {
      return await this.prisma.document.create({
        data: {
          userId,
          filename: safeFilename,
          mimeType: file.mimetype,
          size: file.size,
          filePath: storedPath,
          storageType: "local",
          status: "pending",
        },
      });
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /** 按创建时间倒序返回指定用户的文档列表。 */
  findByUser(userId: string): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** 按文档 ID 与用户 ID 联合查询，未找到或无权限统一返回 404。 */
  async findById(documentId: string, userId: string): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        userId,
      },
    });

    // 未找到和无权限保持相同响应，避免泄露其他用户的文档 ID。
    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  /** 校验文档归属后删除物理文件和数据库记录。 */
  async delete(documentId: string, userId: string): Promise<Document> {
    const document = await this.findById(documentId, userId);
    if (document.filePath) {
      const absolutePath = this.resolveStoredPath(document.filePath);
      await unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      });

      // 仅在目录为空时删除用户目录；rm 失败不会影响文档删除。
      await rm(resolve(absolutePath, ".."), { recursive: false }).catch(
        () => undefined,
      );
    }

    return this.prisma.document.delete({ where: { id: documentId } });
  }

  /**
   * 将文档标记为 processing，并调度 ChunkService 在请求结束后继续处理。
   * 该方法只负责启动任务，因此控制器可以立即返回 HTTP 202。
   */
  async process(documentId: string, userId: string): Promise<{
    id: string;
    status: "processing";
  }> {
    const document = await this.findById(documentId, userId);
    if (document.status === "processing") {
      throw new ConflictException("Document is already being processed");
    }
    if (!document.filePath) {
      throw new BadRequestException("Document has no local file");
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: "processing", chunkCount: 0 },
    });

    // 将耗时的解析与本地模型推理移出请求生命周期，接口可立即返回 202。
    setImmediate(() => {
      void this.chunkService
        .processDocument(document.id, userId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to process document ${document.id}: ${message}`,
          );
        });
    });

    return { id: document.id, status: "processing" };
  }

  /** 在服务层再次校验 MIME、空文件和 10MB 限制，避免绕过 Multer。 */
  private validateFile(file: UploadedDocumentFile): void {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException("A file is required");
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type: ${file.mimetype}`,
      );
    }
    if (file.size <= 0) {
      throw new BadRequestException("File must not be empty");
    }
    if (file.size > MAX_DOCUMENT_SIZE || file.buffer.length > MAX_DOCUMENT_SIZE) {
      throw new BadRequestException("File size must not exceed 10MB");
    }
  }

  /** 拼接新文件路径，并确保结果仍位于 uploads 根目录。 */
  private resolveInsideUploadRoot(...segments: string[]): string {
    const candidate = resolve(this.uploadRoot, ...segments);
    if (
      candidate !== this.uploadRoot &&
      !candidate.startsWith(`${this.uploadRoot}${sep}`)
    ) {
      throw new BadRequestException("Invalid upload path");
    }

    return candidate;
  }

  /** 校验数据库中保存的路径，禁止读取或删除 uploads 之外的文件。 */
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
