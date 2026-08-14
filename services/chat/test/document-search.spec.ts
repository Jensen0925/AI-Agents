import { describe, expect, it, mock } from "bun:test";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { EmbeddingService } from "../src/llm/embedding/embedding.service";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import {
  DOCUMENT_EMBEDDING_DIMENSION,
  DocumentEmbeddingService,
} from "../src/document/embedding.service";
import { SearchController } from "../src/document/search.controller";
import { SearchService } from "../src/document/search.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("DocumentEmbeddingService", () => {
  it("normalizes the 384-dimensional vectors returned by the shared model", async () => {
    const vector = Array.from({ length: DOCUMENT_EMBEDDING_DIMENSION }, () => 0);
    vector[0] = 3;
    vector[1] = 4;
    const embedDocuments = mock(async () => [vector]);
    const service = new DocumentEmbeddingService({
      embedDocuments,
    } as unknown as EmbeddingService);

    const [result] = await service.embedTexts(["需求文本"]);

    expect(embedDocuments).toHaveBeenCalledWith(["需求文本"]);
    expect(result).toHaveLength(DOCUMENT_EMBEDDING_DIMENSION);
    expect(result?.[0]).toBeCloseTo(0.6);
    expect(result?.[1]).toBeCloseTo(0.8);
    expect(
      Math.sqrt(result.reduce((sum, value) => sum + value * value, 0)),
    ).toBeCloseTo(1);
  });
});

describe("SearchService", () => {
  it("uses pgvector cosine distance and filters by userId", async () => {
    const queryRaw = mock(async () => [
      { content: "仅属于 user-1 的内容", score: "0.875" },
    ]);
    const embedTexts = mock(async () => [
      Array.from({ length: DOCUMENT_EMBEDDING_DIMENSION }, () => 0.1),
    ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const service = new SearchService(
      prisma,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.similaritySearch("蓝牙耳机", "user-1", 3)).resolves.toEqual([
      { content: "仅属于 user-1 的内容", score: 0.875 },
    ]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const call = queryRaw.mock.calls[0] as unknown[];
    expect(String(call[0])).toContain("<=>");
    expect(String(call[0])).toContain('"documents"');
    expect(call).toContain("user-1");
    expect(call).toContain(3);
  });

  it("filters out documents below the configured relevance threshold", async () => {
    const queryRaw = mock(async () => [
      { content: "用户登录需求", score: "0.81" },
      { content: "无关退换货政策", score: "0.14" },
    ]);
    const embedTexts = mock(async () => [
      Array.from({ length: DOCUMENT_EMBEDDING_DIMENSION }, () => 0.1),
    ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const service = new SearchService(
      prisma,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.similaritySearch("用户登录功能", "user-1", 3)).resolves.toEqual([
      { content: "用户登录需求", score: 0.81 },
    ]);
  });

  it("uses vector plus BM25 retrieval, then returns reranked chunk ids", async () => {
    const queryRaw = mock(async () => {
      const callIndex = queryRaw.mock.calls.length;
      return callIndex === 1
        ? [
            {
              id: "chunk-login",
              documentId: "doc-login",
              chunkIndex: 0,
              content: "登录使用 OAuth2 授权码模式",
              score: 0.9,
            },
          ]
        : [
            {
              id: "chunk-login",
              documentId: "doc-login",
              chunkIndex: 0,
              content: "登录使用 OAuth2 授权码模式",
              score: 0,
            },
            {
              id: "chunk-weather",
              documentId: "doc-weather",
              chunkIndex: 1,
              content: "今天天气不错",
              score: 0,
            },
          ];
    });
    const embedTexts = mock(async (texts: string[]) =>
      texts.length === 1
        ? [[1, 0]]
        : texts.map((_, index) => (index === 0 || index === 1 ? [1, 0] : [0, 1])),
    );
    const service = new SearchService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.search("OAuth2 登录", "user-1", 1)).resolves.toEqual([
      { id: "chunk-login", content: "登录使用 OAuth2 授权码模式", score: 1 },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("SearchController", () => {
  it("is mounted at api/search and protected by JwtAuthGuard", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SearchController)).toBe(
      "api/search",
    );
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SearchController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});
