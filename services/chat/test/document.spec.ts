import { afterEach, describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { Document } from "../src/database/schema";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import type { ChunkService } from "../src/document/chunk.service";
import { DocumentController } from "../src/document/document.controller";
import {
  buildFileResponseHeaders,
  DocumentService,
  inferDocumentCategory,
  isInlineSafeMimeType,
} from "../src/document/document.service";
import { createDatabaseMock } from "./drizzle-test-utils";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env["UPLOAD_DIR"];
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("DocumentService", () => {
  it("filters document lookup by documentId and userId", async () => {
    const database = createDatabaseMock({ select: [[]] });
    const service = new DocumentService(
      database,
      {} as ChunkService,
    );

    await expect(service.findById("document-1", "user-1")).rejects.toThrow(
      "Document not found",
    );
    expect((database.db.select as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("writes an upload, persists metadata and deletes the physical file", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-upload-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const storedDocument = {
      id: "document-1",
      userId: "user-1",
      filename: "requirement.md",
      mimeType: "text/markdown",
      size: 12,
      filePath: join(uploadRoot, "user-1", "document.md"),
      storageType: "local",
      category: "product",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date(),
    } as Document;
    const database = createDatabaseMock({
      select: [
        (values: unknown) => [
          { ...storedDocument, ...(values as Record<string, unknown>) },
        ],
      ],
      returning: [
        (values: unknown) => [{ ...storedDocument, ...(values as Record<string, unknown>) }],
        // DELETE ... RETURNING：删除需要返回被删行，否则服务层会按「未命中」处理。
        [storedDocument],
      ],
    });
    const service = new DocumentService(
      database,
      {} as ChunkService,
    );

    const document = await service.upload(
      "user-1",
      {
        buffer: Buffer.from("需求规范"),
        mimetype: "text/markdown",
        originalname: "requirement.md",
        size: Buffer.byteLength("需求规范"),
      },
      "requirement.md",
    );
    const serviceRoot = process.cwd().endsWith("services/chat")
      ? process.cwd()
      : resolve(process.cwd(), "services/chat");
    const absolutePath = resolve(serviceRoot, document.filePath as string);

    await access(absolutePath);
    expect(document.status).toBe("pending");
    expect(document.userId).toBe("user-1");
    expect(document.category).toBe("product");

    await service.delete(document.id, "user-1");
    await expect(access(absolutePath)).rejects.toThrow();
    expect((database.db.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("infers a category on upload and allows the owner to update it", async () => {
    expect(inferDocumentCategory("API 安全规范.pdf")).toBe("engineering");
    expect(inferDocumentCategory("员工考勤制度.docx")).toBe("hr");
    expect(inferDocumentCategory("requirement.md")).toBe("product");
    expect(inferDocumentCategory("UI design.pdf")).toBe("design");

    const storedDocument = {
      id: "document-category",
      userId: "user-1",
      filename: "API 安全规范.pdf",
      mimeType: "application/pdf",
      size: 10,
      filePath: "uploads/user-1/document.pdf",
      storageType: "local",
      category: "engineering",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date(),
    } as Document;
    const database = createDatabaseMock({
      select: [
        (values: unknown) => [
          { ...storedDocument, ...(values as Record<string, unknown>) },
        ],
      ],
      returning: [[{ ...storedDocument, category: "design" }]],
    });
    const service = new DocumentService(database, {} as ChunkService);

    const updated = await service.updateCategory(
      storedDocument.id,
      "user-1",
      "design",
    );

    expect(updated.category).toBe("design");
    expect((database.db.update as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    await expect(
      service.updateCategory(storedDocument.id, "user-1", "unknown"),
    ).rejects.toThrow("Invalid document category");
  });

  it("reads the original markdown file for an authorized preview", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-preview-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const storedDocument = {
      id: "document-preview",
      userId: "user-1",
      filename: "login.md",
      mimeType: "text/markdown",
      size: 37,
      filePath: join(uploadRoot, "user-1", "login.md"),
      storageType: "local",
      category: "product",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date(),
    } as Document;
    const database = createDatabaseMock({
      select: [
        (values: unknown) => [
          { ...storedDocument, ...(values as Record<string, unknown>) },
        ],
      ],
      returning: [
        (values: unknown) => [{ ...storedDocument, ...(values as Record<string, unknown>) }],
      ],
    });
    const service = new DocumentService(database, {} as ChunkService);
    const content = "# 登录需求\n\n支持账号密码登录。";

    const document = await service.upload(
      "user-1",
      {
        buffer: Buffer.from(content),
        mimetype: "text/markdown",
        originalname: "login.md",
        size: Buffer.byteLength(content),
      },
      "login.md",
    );
    const preview = await service.getPreview(document.id, "user-1");

    expect(preview.filename).toBe("login.md");
    expect(preview.mimeType).toBe("text/markdown");
    expect(preview.buffer.toString("utf8")).toBe(content);
    expect((database.db.select as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("returns a clear error when a stored preview file is missing", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-missing-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const database = createDatabaseMock({ select: [[{
          id: "missing-document",
          userId: "user-1",
          filename: "missing.pdf",
          mimeType: "application/pdf",
          size: 10,
          filePath: join(uploadRoot, "user-1", "missing.pdf"),
          storageType: "local",
          status: "pending",
          chunkCount: 0,
          createdAt: new Date(),
    }]] });
    const service = new DocumentService(database, {} as ChunkService);

    await expect(
      service.getPreview("missing-document", "user-1"),
    ).rejects.toThrow("Document file not found");
  });
});

describe("DocumentController", () => {
  it("protects every document route with JwtAuthGuard", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DocumentController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });
});

describe("buildFileResponseHeaders", () => {
  const base = { filename: "报告.pdf", size: 123 };

  it("对可执行脚本的类型强制下载并加 CSP sandbox", () => {
    // SVG 可内嵌 <script>，内联返回会在同源上下文执行脚本并读走令牌。
    const svg = buildFileResponseHeaders({
      ...base,
      mimeType: "image/svg+xml",
      filename: "evil.svg",
    });

    expect(svg["Content-Disposition"]).toMatch(/^attachment;/);
    expect(svg["Content-Security-Policy"]).toContain("sandbox");
    expect(svg["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("把 text/html 之类的类型也一律降级为下载", () => {
    for (const mimeType of ["text/html", "application/xhtml+xml", "application/pdf"]) {
      const headers = buildFileResponseHeaders({ ...base, mimeType });
      expect(headers["Content-Disposition"]).toMatch(/^attachment;/);
      expect(headers["Content-Security-Policy"]).toContain("sandbox");
    }
  });

  it("仅对位图与纯文本内联，且不带 sandbox", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/webp", "text/plain"]) {
      const headers = buildFileResponseHeaders({ ...base, mimeType });
      expect(headers["Content-Disposition"]).toMatch(/^inline;/);
      expect(headers["Content-Security-Policy"]).toBeUndefined();
    }
  });

  it("忽略 MIME 参数并按 RFC 5987 编码文件名", () => {
    const headers = buildFileResponseHeaders({
      mimeType: "image/png; charset=binary",
      filename: "截图 (1).png",
      size: 9,
    });

    expect(headers["Content-Disposition"]).toMatch(/^inline;/);
    // 括号需要被转义，否则会截断 filename* 表达式。
    expect(headers["Content-Disposition"]).toContain("%28");
    expect(headers["Content-Disposition"]).toContain("%29");
    expect(headers["Content-Length"]).toBe("9");
  });

  it("isInlineSafeMimeType 大小写不敏感且拒绝空值/异常值", () => {
    expect(isInlineSafeMimeType("IMAGE/PNG")).toBe(true);
    expect(isInlineSafeMimeType("image/svg+xml")).toBe(false);
    expect(isInlineSafeMimeType("")).toBe(false);
    expect(isInlineSafeMimeType("; charset=utf-8")).toBe(false);
  });
});

describe("DocumentService 的处理状态与删除顺序", () => {
  function storedDocument(overrides: Partial<Document> = {}): Document {
    return {
      id: "document-1",
      userId: "user-1",
      filename: "requirement.md",
      mimeType: "text/markdown",
      size: 4,
      filePath: null,
      storageType: "local",
      category: "product",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    } as Document;
  }

  function chunkServiceStub(): ChunkService {
    return { processDocument: vi.fn(async () => ({})) } as unknown as ChunkService;
  }

  it("条件更新命中 0 行时视为已在处理中，避免并发起两个处理任务", async () => {
    const document = storedDocument({ filePath: "uploads/user-1/requirement.md" });
    const database = createDatabaseMock({
      // 两次调用各自做一次归属查询。
      select: [[document], [document]],
      // 第一次条件更新命中并返回 id；第二次（并发的那次）没有行可更新。
      returning: [[{ id: "document-1" }], []],
    });
    const service = new DocumentService(database, chunkServiceStub());

    await expect(service.process("document-1", "user-1")).resolves.toEqual({
      id: "document-1",
      status: "processing",
    });
    await expect(service.process("document-1", "user-1")).rejects.toThrow(
      "already being processed",
    );
  });

  it("先删记录再删文件：物理文件缺失也不让接口失败", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudsage-docs-"));
    temporaryDirectories.push(directory);
    process.env["UPLOAD_DIR"] = directory;

    // 记录指向一个并不存在的文件，模拟文件被外部清理或删除中途失败。
    const filePath = join("uploads", "user-1", "missing.md");
    const database = createDatabaseMock({
      select: [[storedDocument({ filePath })]],
      returning: [[storedDocument({ filePath })]],
    });
    const service = new DocumentService(database, chunkServiceStub());

    await expect(service.delete("document-1", "user-1")).resolves.toMatchObject({
      id: "document-1",
    });
    expect((database.db.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("记录已被并发删除时返回 404，而不是静默成功", async () => {
    const database = createDatabaseMock({
      select: [[storedDocument()]],
      // 条件删除（DELETE ... RETURNING）没有命中任何行。
      returning: [[]],
    });
    const service = new DocumentService(database, chunkServiceStub());

    await expect(service.delete("document-1", "user-1")).rejects.toThrow(
      "Document not found",
    );
  });
});
