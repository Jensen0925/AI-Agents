import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { EmbeddingService } from "../src/llm/embedding/embedding.service";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import {
  DOCUMENT_EMBEDDING_DIMENSION,
  DocumentEmbeddingService,
} from "../src/document/embedding.service";
import { SearchController } from "../src/document/search.controller";
import { SearchService } from "../src/document/search.service";
import { createDatabaseMock, sqlText, sqlValues } from "./drizzle-test-utils";

describe("DocumentEmbeddingService", () => {
  it("normalizes the 384-dimensional vectors returned by the shared model", async () => {
    const vector = Array.from({ length: DOCUMENT_EMBEDDING_DIMENSION }, () => 0);
    vector[0] = 3;
    vector[1] = 4;
    const embedDocuments = vi.fn(async () => [vector]);
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

/**
 * 从 drizzle 的 SQL 对象里抽出可读文本，用于按「SQL 内容」而不是「调用顺序」
 * 分派 mock。实现见 `./drizzle-test-utils`，与检索评测共用同一份解析逻辑。
 */

const EMBEDDING_VECTOR = Array.from(
  { length: DOCUMENT_EMBEDDING_DIMENSION },
  () => 0.1,
);

describe("SearchService", () => {
  it("按 userId 参数化过滤，并把 pgvector 余弦距离解析为数值分数", async () => {
    const execute = vi.fn(async () => [
      { content: "仅属于 user-1 的内容", score: "0.875" },
    ]);
    const database = createDatabaseMock({
      // 前置存在性检查：该用户名下确实有可检索的文档块。
      select: [[{ id: "document-1" }]],
    });
    (database.db.execute as ReturnType<typeof vi.fn>).mockImplementation(execute);
    const embedTexts = vi.fn(async () => [EMBEDDING_VECTOR]);
    const service = new SearchService(
      database,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.similaritySearch("蓝牙耳机", "user-1", 3)).resolves.toEqual([
      { content: "仅属于 user-1 的内容", score: 0.875 },
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    // 越权边界：userId 必须作为绑定参数传入，而不是被拼进 SQL 文本。
    const [query] = execute.mock.calls[0] as unknown as [unknown];
    expect(sqlText(query)).toContain('documents."userId" =');
    expect(sqlValues(query)).toContain("user-1");
  });

  it("没有可检索文档时直接返回空数组，不触发 embedding 下载", async () => {
    const database = createDatabaseMock({ select: [[]] });
    const embedTexts = vi.fn(async () => [EMBEDDING_VECTOR]);
    const service = new SearchService(
      database,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.similaritySearch("蓝牙耳机", "user-1", 3)).resolves.toEqual([]);
    expect(embedTexts).not.toHaveBeenCalled();
    expect(database.db.execute).not.toHaveBeenCalled();
  });

  it("filters out documents below the configured relevance threshold", async () => {
    const database = createDatabaseMock({
      select: [[{ id: "document-1" }]],
      execute: [
        [
          { content: "用户登录需求", score: "0.81" },
          { content: "无关退换货政策", score: "0.14" },
        ],
      ],
    });
    const embedTexts = vi.fn(async () => [EMBEDDING_VECTOR]);
    const service = new SearchService(
      database,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    // 默认 minScore 为 0.35（见 services/chat/config/langchain.yaml）。
    await expect(service.similaritySearch("用户登录功能", "user-1", 3)).resolves.toEqual([
      { content: "用户登录需求", score: 0.81 },
    ]);
  });

  it("把检索故障通过 onDegraded 上报，而不是静默等同于“没有结果”", async () => {
    const database = createDatabaseMock({ select: [[{ id: "document-1" }]] });
    (database.db.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        throw new Error("pgvector extension is not available");
      },
    );
    const service = new SearchService(
      database,
      {
        embedTexts: vi.fn(async () => [EMBEDDING_VECTOR]),
      } as unknown as DocumentEmbeddingService,
    );

    const degraded: string[] = [];
    await expect(
      service.similaritySearch("蓝牙耳机", "user-1", 3, undefined, (reason) =>
        degraded.push(reason),
      ),
    ).resolves.toEqual([]);

    // 空结果 + 降级原因必须同时可见，否则上游会把故障渲染成「没有资料」。
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("pgvector");
  });

  it("消化 node-postgres 的 QueryResult 形态：数据行在 `.rows` 上而不是裸数组", async () => {
    // 真实驱动下 db.execute() 返回 { rows, rowCount, ... }。把返回值当数组用会
    // 抛 `rows.map is not a function`，被降级逻辑吞成「检索不可用」→ 结果恒为空，
    // 因此必须显式解包，而不是靠 as 断言绕过类型。
    const vectorRows = [
      {
        id: "chunk-login",
        documentId: "doc-login",
        chunkIndex: 0,
        content: "登录使用 OAuth2 授权码模式",
        score: "0.9",
      },
    ];
    const corpusRows = [
      {
        id: "chunk-login",
        documentId: "doc-login",
        chunkIndex: 0,
        content: "登录使用 OAuth2 授权码模式",
        score: 0,
      },
    ];
    const database = createDatabaseMock({ select: [[{ id: "document-1" }]] });
    (database.db.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (query: unknown) => {
        const rows = sqlText(query).includes('"embedding" <=>')
          ? vectorRows
          : corpusRows;
        return { rows, rowCount: rows.length };
      },
    );
    const embedTexts = vi.fn(async (texts: string[]) =>
      texts.length === 1 ? [[1, 0]] : texts.map(() => [1, 0]),
    );
    const service = new SearchService(
      database,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.similaritySearch("OAuth2 登录", "user-1", 1)).resolves.toEqual([
      {
        id: "chunk-login",
        documentId: "doc-login",
        chunkIndex: 0,
        content: "登录使用 OAuth2 授权码模式",
        score: 0.9,
      },
    ]);
    // hybrid 的 BM25 语料召回走的是同一套解包逻辑。
    await expect(service.search("OAuth2 登录", "user-1", 1)).resolves.toHaveLength(1);
  });

  it("uses vector plus BM25 retrieval, then returns reranked chunk ids", async () => {
    const vectorRows = [
      {
        id: "chunk-login",
        documentId: "doc-login",
        chunkIndex: 0,
        content: "登录使用 OAuth2 授权码模式",
        score: 0.9,
      },
    ];
    const corpusRows = [
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
    // 按 SQL 内容分派：向量召回含 `"embedding" <=>`，BM25 语料查询不含。
    const execute = vi.fn(async (query: unknown) =>
      sqlText(query).includes('"embedding" <=>') ? vectorRows : corpusRows,
    );
    const database = createDatabaseMock({
      select: [[{ id: "document-1" }]],
    });
    (database.db.execute as ReturnType<typeof vi.fn>).mockImplementation(execute);
    const embedTexts = vi.fn(async (texts: string[]) =>
      texts.length === 1
        ? [[1, 0]]
        : texts.map((_, index) => (index <= 1 ? [1, 0] : [0, 1])),
    );
    const service = new SearchService(
      database,
      { embedTexts } as unknown as DocumentEmbeddingService,
    );

    await expect(service.search("OAuth2 登录", "user-1", 1)).resolves.toEqual([
      {
        id: "chunk-login",
        documentId: "doc-login",
        chunkIndex: 0,
        content: "登录使用 OAuth2 授权码模式",
        score: 1,
      },
    ]);
    // 两次召回各一次 execute（前置存在性检查走 select）。
    expect(execute).toHaveBeenCalledTimes(2);
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
