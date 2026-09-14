import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Injectable } from "@nestjs/common";
import { Document } from "@langchain/core/documents";
import { EmbeddingService } from "./embedding.service";

const INITIAL_DOCUMENTS = [
  "需求规范片段：需求应明确目标、目标用户、使用场景、功能范围、系统边界和非功能约束。",
  "验收标准片段：每项核心能力都应有可验证的输入、处理结果和通过条件。",
  "约束说明片段：明确约束应保留原文事实，不得编造未在需求或规范中出现的信息。",
];

export interface VectorSearchResult {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * 封装进程内 MemoryVectorStore，用于最小化验证向量写入和相似度检索。
 * 数据不会跨进程持久化，服务重启后会重新初始化。
 */
@Injectable()
export class VectorStoreService {
  /**
   * namespace 数量上限。没有上限时，任何能影响 namespace 取值的调用方
   * 都可以让进程内 Map 无界增长（每个条目持有一份完整向量库）。
   */
  private static readonly MAX_NAMESPACES = 64;

  private readonly vectorStores = new Map<string, MemoryVectorStore>();
  private readonly initializations = new Map<string, Promise<void>>();

  constructor(private readonly embeddingService: EmbeddingService) {}

  /** 首次访问时创建向量库并且只灌入一次内置需求规范片段。 */
  private async getVectorStore(namespace: string): Promise<MemoryVectorStore> {
    let vectorStore = this.vectorStores.get(namespace);
    if (!vectorStore) {
      this.evictLeastRecentlyAdded(namespace);
      vectorStore = new MemoryVectorStore(this.embeddingService);
      this.vectorStores.set(namespace, vectorStore);
    }

    const existing = this.initializations.get(namespace);
    if (existing) {
      await existing;
      return vectorStore;
    }

    const pending = vectorStore.addDocuments(
      INITIAL_DOCUMENTS.map(
        (text, index) =>
          new Document({
            pageContent: text,
            metadata: { source: "initial", index },
          }),
      ),
    );
    this.initializations.set(namespace, pending);

    try {
      await pending;
    } catch (error) {
      // 失败的初始化 Promise 必须从缓存移除，否则一次向量化失败
      // （例如首次下载模型超时）之后该 namespace 就再也无法使用——
      // 后续每次调用都 await 同一个 rejected Promise。
      if (this.initializations.get(namespace) === pending) {
        this.initializations.delete(namespace);
      }
      throw error;
    }

    return vectorStore;
  }

  /** Map 保持插入顺序，从头淘汰最久未新增的 namespace。 */
  private evictLeastRecentlyAdded(incoming: string): void {
    if (this.vectorStores.size < VectorStoreService.MAX_NAMESPACES) return;

    // 删除后 size 必须严格小于上限，随后插入新 namespace 才不会越界。
    let overflow =
      this.vectorStores.size - VectorStoreService.MAX_NAMESPACES + 1;
    const evicted: string[] = [];
    for (const key of this.vectorStores.keys()) {
      if (overflow <= 0) break;
      // 调用方保证 incoming 尚未入库，这里只是防御。
      if (key === incoming) continue;
      evicted.push(key);
      overflow -= 1;
    }
    // 先收集再删除，避免在遍历 Map 的同时修改它。
    for (const key of evicted) {
      this.vectorStores.delete(key);
      this.initializations.delete(key);
    }
  }

  /** 将文本作为 API 来源文档写入内存向量库，并返回新增数量。 */
  async addTexts(texts: string[], namespace = "default"): Promise<number> {
    const vectorStore = await this.getVectorStore(namespace);
    const documents = texts.map(
      (text) => new Document({ pageContent: text, metadata: { source: "api" } }),
    );
    await vectorStore.addDocuments(documents);
    return documents.length;
  }

  /** 按查询向量返回前 k 个相似文档、分数及元数据。 */
  async search(
    query: string,
    k: number,
    namespace = "default",
  ): Promise<VectorSearchResult[]> {
    const vectorStore = await this.getVectorStore(namespace);
    const results = await vectorStore.similaritySearchWithScore(query, k);

    return results.map(([document, score]) => ({
      text: document.pageContent,
      score,
      metadata: document.metadata as Record<string, unknown>,
    }));
  }
}
