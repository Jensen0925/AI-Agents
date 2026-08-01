import { Injectable } from "@nestjs/common";
import {
  EmbeddingService,
  LOCAL_EMBEDDING_MODEL,
} from "../llm/embedding/embedding.service";

export const DOCUMENT_EMBEDDING_DIMENSION = 384;
export const DOCUMENT_EMBEDDING_MODEL = LOCAL_EMBEDDING_MODEL;

/**
 * 文档域向量化服务。
 * 复用第四章的 Xenova multilingual MiniLM 单例，避免同一进程重复加载模型。
 */
@Injectable()
export class DocumentEmbeddingService {
  constructor(private readonly embeddingService: EmbeddingService) {}

  /**
   * 对文本执行 mean pooling 向量化，并将每个结果再次规范为 384 维 L2 单位向量。
   * 返回顺序与输入文本顺序保持一致。
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const vectors = await this.embeddingService.embedDocuments(texts);

    return vectors.map((vector, index) => {
      if (vector.length !== DOCUMENT_EMBEDDING_DIMENSION) {
        throw new Error(
          `Embedding ${index} must have ${DOCUMENT_EMBEDDING_DIMENSION} dimensions, received ${vector.length}`,
        );
      }
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new Error(`Embedding ${index} contains a non-finite value`);
      }

      const norm = Math.sqrt(
        vector.reduce((sum, value) => sum + value * value, 0),
      );
      if (norm === 0) {
        throw new Error(`Embedding ${index} has zero L2 norm`);
      }

      return vector.map((value) => value / norm);
    });
  }
}
