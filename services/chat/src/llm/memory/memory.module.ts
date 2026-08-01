import { Module } from "@nestjs/common";
import { MessageModule } from "../../message/message.module";
import { RunnableMemoryService } from "./runnable-memory.service";

/** 注册基于 PostgreSQL 消息历史的 Runnable Memory。 */
@Module({
  imports: [MessageModule],
  providers: [RunnableMemoryService],
  exports: [RunnableMemoryService],
})
export class MemoryModule {}
