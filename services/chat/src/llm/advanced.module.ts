import { Module } from "@nestjs/common";
import { DocumentModule } from "../document/document.module";
import { MessageModule } from "../message/message.module";
import {
  AgentsController,
  EmbeddingController,
  FilesystemController,
  MemoryController,
} from "./advanced.controller";
import { AdvancedAnalysisService } from "./advanced-analysis.service";
import { OrchestratorService } from "./agents/orchestrator.service";
import { EmbeddingModule } from "./embedding/embedding.module";
import { FilesystemService } from "./filesystem/filesystem.service";
import { MemoryModule } from "./memory/memory.module";

@Module({
  imports: [DocumentModule, EmbeddingModule, MemoryModule, MessageModule],
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
  ],
  providers: [
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
  exports: [
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
  ],
})
export class AdvancedModule {}
