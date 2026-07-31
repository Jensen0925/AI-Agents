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

@Injectable()
export class VectorStoreService {
  private vectorStore?: MemoryVectorStore;
  private initialization?: Promise<void>;

  constructor(private readonly embeddingService: EmbeddingService) {}

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

  async addTexts(texts: string[]): Promise<number> {
    const vectorStore = await this.getVectorStore();
    const documents = texts.map(
      (text) => new Document({ pageContent: text, metadata: { source: "api" } }),
    );
    await vectorStore.addDocuments(documents);
    return documents.length;
  }

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
