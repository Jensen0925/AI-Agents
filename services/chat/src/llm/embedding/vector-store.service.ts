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
  private vectorStore?: MemoryVectorStore;
  private initialization?: Promise<void>;

  constructor(private readonly embeddingService: EmbeddingService) {}

  /** 首次访问时创建向量库并且只灌入一次内置需求规范片段。 */
  private async getVectorStore(): Promise<MemoryVectorStore> {
    if (!this.vectorStore) {
      this.vectorStore = new MemoryVectorStore(this.embeddingService);
    }

    if (!this.initialization) {
      this.initialization = this.vectorStore.addDocuments(
        INITIAL_DOCUMENTS.map(
          (text, index) =>
            new Document({
              pageContent: text,
              metadata: { source: "initial", index },
            }),
        ),
      );
    }

    await this.initialization;
    return this.vectorStore;
  }

  /** 将文本作为 API 来源文档写入内存向量库，并返回新增数量。 */
  async addTexts(texts: string[]): Promise<number> {
    const vectorStore = await this.getVectorStore();
    const documents = texts.map(
      (text) => new Document({ pageContent: text, metadata: { source: "api" } }),
    );
    await vectorStore.addDocuments(documents);
    return documents.length;
  }

  /** 按查询向量返回前 k 个相似文档、分数及元数据。 */
  async search(query: string, k: number): Promise<VectorSearchResult[]> {
    const vectorStore = await this.getVectorStore();
    const results = await vectorStore.similaritySearchWithScore(query, k);

    return results.map(([document, score]) => ({
      text: document.pageContent,
      score,
      metadata: document.metadata as Record<string, unknown>,
    }));
  }
}
