import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SseController } from "./sse.controller";
import { SseService } from "./sse.service";
import { TaskEventController } from "./task-event.controller";

@Module({
  controllers: [SseController, TaskEventController],
  providers: [SseService, JwtAuthGuard],
  exports: [SseService],
})
export class SseModule {}
