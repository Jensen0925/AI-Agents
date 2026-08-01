import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";
import { VectorStoreService } from "./vector-store.service";

/** 共享本地 Embedding 模型与内存向量库，避免跨模块重复注册模型实例。 */
@Module({
  providers: [EmbeddingService, VectorStoreService],
  exports: [EmbeddingService, VectorStoreService],
})
export class EmbeddingModule {}
