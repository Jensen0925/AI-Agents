import { Module } from "@nestjs/common";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";
import { RequirementService } from "./requirement.service";

@Module({
  controllers: [LlmController],
  providers: [LlmService, RequirementService],
  exports: [LlmService, RequirementService],
})
export class LlmModule {}
