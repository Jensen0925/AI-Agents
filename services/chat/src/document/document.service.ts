import { and, desc, eq } from "drizzle-orm";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseService } from "../database/database.service";
import { documents, type Document } from "../database/schema";
import { CategoryService } from "./category.service";
import { ChunkService } from "./chunk.service";

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

export const DOCUMENT_CATEGORY_IDS = [
  "product",
  "engineering",
  "hr",
  "sales",
  "design",
] as const;

export type DocumentCategoryId = (typeof DOCUMENT_CATEGORY_IDS)[number];

export function isDocumentCategoryId(value: string): value is DocumentCategoryId {
  return (DOCUMENT_CATEGORY_IDS as readonly string[]).includes(value);
}

export function inferDocumentCategory(filename: string): DocumentCategoryId {
  const normalized = filename.toLocaleLowerCase();
  if (
    /设计|视觉|组件|样式|交互/u.test(normalized) ||
    /(^|[^a-z0-9])(ui|ux)([^a-z0-9]|$)/u.test(normalized)
  ) {
    return "design";
  }
  if (/员工|人事|考勤|绩效|福利|招聘|薪酬/u.test(normalized)) return "hr";
  if (/销售|市场|客户|报价|商务|营销/u.test(normalized)) return "sales";
  if (
    /技术|架构|接口|开发|数据库|安全|部署|运维|代码|规范/u.test(
      normalized,
    ) || /(^|[^a-z0-9])api([^a-z0-9]|$)/u.test(normalized)
  ) {
    return "engineering";
  }
  return "product";
}

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

/** 对话附件在文档类型之外额外允许常见图片，便于随消息发送截图。 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  ...ALLOWED_DOCUMENT_MIME_TYPES,
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/heic",
]);

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** 对话附件的落盘结果；id 即相对 uploads 根目录的路径，用于回读。 */
export interface AttachmentRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** 前端可直接使用的回读地址。 */
  url: string;
}

export interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface DocumentPreview {
  buffer: Buffer;
  filename: string;
  mimeType: string;
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

/** 附件不在 documents 表里存 mimeType，回读时按扩展名推导 Content-Type。 */
const ATTACHMENT_EXTENSION_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

function guessAttachmentMimeType(filePath: string): string {
  return (
    ATTACHMENT_EXTENSION_MIME_TYPES[extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
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
    private readonly database: DatabaseService,
    private readonly chunkService: ChunkService,
    /**
     * 可选依赖：只有配置了自定义分类能力（DocumentModule 提供）时才会注入。
     * 单元测试直接构造 DocumentService 时不传，此时仅接受内置分类。
     */
    private readonly categoryService?: CategoryService,
  ) {}

  /**
   * 归一化分类取值：内置分类直接放行，其余值需要命中当前用户的自定义分类。
   * 这样 documents.category 既能存内置 id，也能存 categories 表的主键。
   */
  private async resolveCategory(
    userId: string,
    category: string,
  ): Promise<string> {
    const normalized = category.trim();
    if (!normalized) {
      throw new BadRequestException("Invalid document category");
    }
    if (isDocumentCategoryId(normalized)) {
      return normalized;
    }
    if (await this.categoryService?.belongsToUser(userId, normalized)) {
      return normalized;
    }

    throw new BadRequestException("Invalid document category");
  }

  /**
   * 校验并保存内存中的上传文件，然后创建 pending 状态的数据库记录。
   * 元数据写入失败时会回滚已落盘的文件，避免产生无主文件。
   */
  async upload(
    userId: string,
    file: UploadedDocumentFile,
    filename: string,
    category?: string,
  ): Promise<Document> {
    this.validateFile(file);
    const normalizedFilename = filename || file.originalname;
    const normalizedCategory = category?.trim();
    const documentCategory = normalizedCategory
      ? await this.resolveCategory(userId, normalizedCategory)
      : inferDocumentCategory(normalizedFilename);

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
    const storedPath = this.uploadRoot.startsWith(`${this.serviceRoot}${sep}`)
      ? relative(this.serviceRoot, absolutePath)
      : absolutePath;

    await mkdir(userDirectory, { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: "wx" });

    try {
      const [document] = await this.database.db
        .insert(documents)
        .values({
          id: crypto.randomUUID(),
          userId,
          filename: safeFilename,
          mimeType: file.mimetype,
          size: file.size,
          filePath: storedPath,
          storageType: "local",
          category: documentCategory,
          status: "pending",
        })
        .returning();
      return document!;
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 保存对话附件：只落盘，不写 documents 表，避免附件污染知识库与检索语料。
   * 文件统一放在 uploads/attachments/<userId>/ 下；id 即相对 uploads 的路径，
   * 回读时经 resolveInsideUploadRoot 校验，保证不会越出 uploads 目录。
   */
  async uploadAttachment(
    userId: string,
    file: UploadedDocumentFile,
    filename?: string,
  ): Promise<AttachmentRecord> {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException("A file is required");
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported attachment type: ${file.mimetype}`,
      );
    }
    if (file.size <= 0) {
      throw new BadRequestException("Attachment must not be empty");
    }
    if (
      file.size > MAX_ATTACHMENT_SIZE ||
      file.buffer.length > MAX_ATTACHMENT_SIZE
    ) {
      throw new BadRequestException("Attachment size must not exceed 10MB");
    }

    const safeUserId = sanitizePathSegment(userId, "anonymous");
    const safeFilename = sanitizePathSegment(
      filename || file.originalname,
      "attachment",
    );
    const directory = this.resolveInsideUploadRoot("attachments", safeUserId);
    // 加 6 位随机后缀：同一毫秒上传同名文件不会因 wx 标志抛 EEXIST。
    const storedFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFilename}`;
    const absolutePath = this.resolveInsideUploadRoot(
      "attachments",
      safeUserId,
      storedFilename,
    );

    await mkdir(directory, { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: "wx" });

    const id = relative(this.uploadRoot, absolutePath);
    return {
      id,
      filename: safeFilename,
      mimeType: file.mimetype,
      size: file.size,
      url: `/api/attachments/${encodeURIComponent(id)}/raw`,
    };
  }

  /** 读取当前用户自己上传的对话附件，同时校验归属目录。 */
  async getAttachment(userId: string, id: string): Promise<DocumentPreview> {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new BadRequestException("attachment id must be a non-empty string");
    }

    const safeUserId = sanitizePathSegment(userId, "anonymous");
    const ownerRoot = this.resolveInsideUploadRoot("attachments", safeUserId);
    let absolutePath: string;
    try {
      absolutePath = this.resolveInsideUploadRoot(id.trim());
    } catch {
      throw new NotFoundException("Attachment not found");
    }
    if (
      absolutePath !== ownerRoot &&
      !absolutePath.startsWith(`${ownerRoot}${sep}`)
    ) {
      throw new NotFoundException("Attachment not found");
    }

    try {
      const buffer = await readFile(absolutePath);
      const storedName = basename(absolutePath);
      return {
        buffer,
        // 去掉上传时加的「时间戳-随机串」前缀，下载时拿回原始文件名。
        filename: storedName.replace(/^\d+-[0-9a-z]{6}-/, "") || storedName,
        mimeType: guessAttachmentMimeType(absolutePath),
        size: buffer.length,
      };
    } catch {
      throw new NotFoundException("Attachment not found");
    }
  }

  /** 按创建时间倒序返回指定用户的文档列表。 */
  async findByUser(userId: string): Promise<Document[]> {
    return this.database.db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt));
  }

  /** 更新文档分类，分类修改不需要重新解析已有向量。 */
  async updateCategory(
    documentId: string,
    userId: string,
    category: string,
  ): Promise<Document> {
    const documentCategory = await this.resolveCategory(userId, category);

    await this.findById(documentId, userId);
    const [document] = await this.database.db
      .update(documents)
      .set({ category: documentCategory })
      .where(eq(documents.id, documentId))
      .returning();
    return document!;
  }

  /** 按文档 ID 与用户 ID 联合查询，未找到或无权限统一返回 404。 */
  async findById(documentId: string, userId: string): Promise<Document> {
    const [document] = await this.database.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1);

    // 未找到和无权限保持相同响应，避免泄露其他用户的文档 ID。
    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  /** 校验文档归属与存储路径后读取原文件，供浏览器内联预览或下载。 */
  async getPreview(
    documentId: string,
    userId: string,
  ): Promise<DocumentPreview> {
    const document = await this.findById(documentId, userId);
    if (!document.filePath) {
      throw new NotFoundException("Document file not found");
    }

    const absolutePath = this.resolveStoredPath(document.filePath);
    try {
      const buffer = await readFile(absolutePath);
      return {
        buffer,
        filename: document.filename,
        mimeType: document.mimeType,
        size: document.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundException("Document file not found");
      }
      throw error;
    }
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

    const [deleted] = await this.database.db
      .delete(documents)
      .where(eq(documents.id, documentId))
      .returning();
    return deleted!;
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

    await this.database.db
      .update(documents)
      .set({ status: "processing", chunkCount: 0 })
      .where(eq(documents.id, document.id));

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
