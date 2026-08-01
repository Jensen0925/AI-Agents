import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { EmbeddingModule } from "../llm/embedding/embedding.module";
import { SseModule } from "../sse/sse.module";
import { ChunkService } from "./chunk.service";
import { DocumentController } from "./document.controller";
import { DocumentService } from "./document.service";
import { DocumentEmbeddingService } from "./embedding.service";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [EmbeddingModule, SseModule],
  controllers: [DocumentController, SearchController],
  providers: [
    ChunkService,
    DocumentEmbeddingService,
    DocumentService,
    SearchService,
    JwtAuthGuard,
  ],
  exports: [
    ChunkService,
    DocumentEmbeddingService,
    DocumentService,
    SearchService,
  ],
})
export class DocumentModule {}
