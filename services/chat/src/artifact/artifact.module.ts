import { Module } from "@nestjs/common";
import { ArtifactController } from "./artifact.controller";
import { ArtifactService } from "./artifact.service";

/** PrismaService 由全局 PrismaModule 提供，避免和 ConversationModule 形成循环依赖。 */
@Module({
  controllers: [ArtifactController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactModule {}
