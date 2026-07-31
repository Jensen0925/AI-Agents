import { Module } from "@nestjs/common";
import {
  AdvancedController,
  AgentsController,
  EmbeddingController,
  FilesystemController,
  MemoryController,
} from "./advanced.controller";
import { AdvancedAnalysisService } from "./advanced-analysis.service";
import { OrchestratorService } from "./agents/orchestrator.service";
import { EmbeddingService } from "./embedding/embedding.service";
import { VectorStoreService } from "./embedding/vector-store.service";
import { FilesystemService } from "./filesystem/filesystem.service";
import { RunnableMemoryService } from "./memory/runnable-memory.service";

@Module({
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    AdvancedController,
  ],
  providers: [
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
  exports: [
    RunnableMemoryService,
    EmbeddingService,
    VectorStoreService,
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
})
export class AdvancedModule {}
