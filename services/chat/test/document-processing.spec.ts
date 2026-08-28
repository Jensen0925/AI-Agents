import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../src/database/schema";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { ChunkService } from "../src/document/chunk.service";
import type { DocumentEmbeddingService } from "../src/document/embedding.service";
import { extractText } from "../src/document/parsers/parser.factory";
import { createDatabaseMock } from "./drizzle-test-utils";
import type { EmitTaskEvent, SseService } from "../src/sse/sse.service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env["UPLOAD_DIR"];
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function serviceRoot(): string {
  return process.cwd().endsWith("services/chat")
    ? process.cwd()
    : resolve(process.cwd(), "services/chat");
}

describe("document parser factory", () => {
  it("routes Markdown files to the text parser", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudsage-parser-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "requirement.md");
    await writeFile(filePath, "\uFEFF需求规范", "utf8");

    await expect(extractText(filePath, "text/markdown")).resolves.toBe(
      "需求规范",
    );
  });

  it("rejects MIME types without a registered parser", () => {
    expect(() => extractText("unknown.bin", "application/octet-stream")).toThrow(
      "Unsupported document MIME type",
    );
  });
});

describe("ChunkService", () => {
  it("splits with 500/50 overlap, embeds chunks and persists vectors", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-chunks-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const userDirectory = join(uploadRoot, "user-1");
    const absolutePath = join(userDirectory, "requirement.txt");
    await mkdir(userDirectory, { recursive: true });
    await writeFile(absolutePath, "a".repeat(700), "utf8");

    const document: Document = {
      id: "document-1",
      userId: "user-1",
      filename: "requirement.txt",
      mimeType: "text/plain",
      size: 700,
      filePath: relative(serviceRoot(), absolutePath),
      storageType: "local",
      category: "product",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date(),
    };
    const database = createDatabaseMock({
      select: [[document]],
      returning: [[{ ...document, status: "done", chunkCount: 2 }]],
    });
    const embedTexts = vi.fn(async (chunks: string[]) =>
      chunks.map(() => Array.from({ length: 384 }, () => 0.1)),
    );
    const emit = vi.fn(async (_userId: string, _event: EmitTaskEvent) => ({}));
    const service = new ChunkService(database, {
      embedTexts,
    } as unknown as DocumentEmbeddingService, {
      emit,
    } as unknown as SseService);

    const result = await service.processDocument("document-1", "user-1");

    expect(embedTexts).toHaveBeenCalledTimes(1);
    const chunks = embedTexts.mock.calls[0]?.[0] as string[];
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 250]);
    expect((database.db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((database.db.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((database.db.update as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map((call) => call[1]?.status)).toEqual([
      "processing",
      "done",
    ]);
    expect(result.status).toBe("done");
  });

  it("emits processing and error events when parsing fails", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "cloudsage-error-"));
    temporaryDirectories.push(uploadRoot);
    process.env["UPLOAD_DIR"] = uploadRoot;

    const userDirectory = join(uploadRoot, "user-1");
    const absolutePath = join(userDirectory, "empty.txt");
    await mkdir(userDirectory, { recursive: true });
    await writeFile(absolutePath, "", "utf8");
    const document: Document = {
      id: "document-error",
      userId: "user-1",
      filename: "empty.txt",
      mimeType: "text/plain",
      size: 0,
      filePath: relative(serviceRoot(), absolutePath),
      storageType: "local",
      category: "product",
      status: "pending",
      chunkCount: 0,
      createdAt: new Date(),
    };
    const database = createDatabaseMock({ select: [[document]] });
    const emit = vi.fn(async (_userId: string, _event: EmitTaskEvent) => ({}));
    const service = new ChunkService(
      database,
      {} as DocumentEmbeddingService,
      { emit } as unknown as SseService,
    );

    await expect(
      service.processDocument("document-error", "user-1"),
    ).rejects.toThrow("Document contains no extractable text");
    expect(emit.mock.calls.map((call) => call[1].status)).toEqual([
      "processing",
      "error",
    ]);
    expect((database.db.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});
