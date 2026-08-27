import { afterEach, describe, expect, it, mock } from "bun:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { Document } from "@prisma/client";
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
import type { PrismaService } from "../src/prisma/prisma.service";

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
    const findFirst = mock(async () => null);
    const prisma = { document: { findFirst } } as unknown as PrismaService;
    const service = new DocumentService(
      prisma,
      {} as ChunkService,
    );

    await expect(service.findById("document-1", "user-1")).rejects.toThrow(
      "Document not found",
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "document-1", userId: "user-1" },
    });
  });

  it("writes an upload, persists metadata and deletes the physical file", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-upload-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    let storedDocument: Document | undefined;
    const create = mock(async ({ data }: { data: Omit<Document, "id" | "createdAt" | "chunkCount"> }) => {
      storedDocument = {
        id: "document-1",
        chunkCount: 0,
        createdAt: new Date(),
        ...data,
      };
      return storedDocument;
    });
    const deleteDocument = mock(async () => storedDocument as Document);
    const prisma = {
      document: {
        create,
        findFirst: mock(async () => storedDocument ?? null),
        delete: deleteDocument,
      },
    } as unknown as PrismaService;
    const service = new DocumentService(
      prisma,
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
    expect(deleteDocument).toHaveBeenCalledWith({
      where: { id: "document-1" },
    });
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
    const update = mock(async ({ data }: { data: { category: string } }) => ({
      ...storedDocument,
      ...data,
    }));
    const prisma = {
      document: {
        findFirst: mock(async () => storedDocument),
        update,
      },
    } as unknown as PrismaService;
    const service = new DocumentService(prisma, {} as ChunkService);

    const updated = await service.updateCategory(
      storedDocument.id,
      "user-1",
      "design",
    );

    expect(updated.category).toBe("design");
    expect(update).toHaveBeenCalledWith({
      where: { id: storedDocument.id },
      data: { category: "design" },
    });
    await expect(
      service.updateCategory(storedDocument.id, "user-1", "unknown"),
    ).rejects.toThrow("Invalid document category");
  });

  it("reads the original markdown file for an authorized preview", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-preview-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    let storedDocument: Document | undefined;
    const prisma = {
      document: {
        create: mock(
          async ({
            data,
          }: {
            data: Omit<Document, "id" | "createdAt" | "chunkCount">;
          }) => {
            storedDocument = {
              id: "document-preview",
              chunkCount: 0,
              createdAt: new Date(),
              ...data,
            };
            return storedDocument;
          },
        ),
        findFirst: mock(async () => storedDocument ?? null),
      },
    } as unknown as PrismaService;
    const service = new DocumentService(prisma, {} as ChunkService);
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
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: "document-preview", userId: "user-1" },
    });
  });

  it("returns a clear error when a stored preview file is missing", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-missing-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const prisma = {
      document: {
        findFirst: mock(async () => ({
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
        })),
      },
    } as unknown as PrismaService;
    const service = new DocumentService(prisma, {} as ChunkService);

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
