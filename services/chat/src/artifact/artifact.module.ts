import { Module } from "@nestjs/common";
import { ArtifactController } from "./artifact.controller";
import { ArtifactService } from "./artifact.service";

/** DatabaseService 由全局 DatabaseModule 提供。 */
@Module({
  controllers: [ArtifactController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactModule {}
