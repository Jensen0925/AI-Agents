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
import { UiChatController } from "./ui-protocol/ui-chat.controller";
import { UiFlowService } from "./ui-protocol/ui-flow.service";
import { UiResponseService } from "./ui-protocol/ui-response.service";
import { ArtifactModule } from "../artifact/artifact.module";

@Module({
  imports: [DocumentModule, EmbeddingModule, MemoryModule, MessageModule, ArtifactModule],
  controllers: [
    MemoryController,
    FilesystemController,
    EmbeddingController,
    AgentsController,
    UiChatController,
  ],
  providers: [
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
    UiResponseService,
    UiFlowService,
  ],
  exports: [
    FilesystemService,
    OrchestratorService,
    AdvancedAnalysisService,
    UiResponseService,
    UiFlowService,
  ],
})
export class AdvancedModule {}
