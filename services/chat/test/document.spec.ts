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
  DocumentService,
  inferDocumentCategory,
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
