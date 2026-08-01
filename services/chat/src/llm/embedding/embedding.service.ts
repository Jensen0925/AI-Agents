import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@xenova/transformers";
import { Embeddings } from "@langchain/core/embeddings";
import { Injectable } from "@nestjs/common";

export const LOCAL_EMBEDDING_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

const remoteHost =
  process.env.TRANSFORMERS_REMOTE_HOST ??
  process.env.HF_ENDPOINT ??
  "https://hf-mirror.com/";
env.remoteHost = remoteHost.endsWith("/") ? remoteHost : `${remoteHost}/`;

/**
 * 基于本地 Transformers 模型实现 LangChain Embeddings 抽象。
 * 查询和文档使用相同的归一化向量空间，可直接用于相似度检索。
 */
@Injectable()
export class EmbeddingService extends Embeddings {
  private extractor?: FeatureExtractionPipeline;
  private extractorPromise?: Promise<FeatureExtractionPipeline>;

  /** 懒加载并复用特征提取管线，并发初始化时共享同一个 Promise。 */
  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) {
      return this.extractor;
    }

    // 共享加载 Promise，避免并发请求重复初始化本地模型。
    this.extractorPromise ??= pipeline(
      "feature-extraction",
      LOCAL_EMBEDDING_MODEL,
    );
    try {
      this.extractor = await this.extractorPromise;
      return this.extractor;
    } catch (error) {
      // 网络恢复后允许下一次请求重新尝试加载，而不是复用失败的 Promise。
      this.extractorPromise = undefined;
      throw error;
    }
  }

  /** 对单条文本执行 mean pooling 和 L2 归一化，返回普通数字数组。 */
  private async embedOne(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const tensor = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    const values = tensor.tolist();
    const vector = Array.isArray(values[0]) ? values[0] : values;

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding model returned an empty vector");
    }

    return vector.map((value) => Number(value));
  }

  /** 生成单条查询文本的向量。 */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  /** 批量生成文档向量，结果顺序与输入文档顺序一致。 */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return Promise.all(documents.map((document) => this.embedOne(document)));
  }
}
