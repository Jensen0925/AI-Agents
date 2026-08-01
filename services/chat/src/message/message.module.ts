import { Module } from "@nestjs/common";
import { MessageService } from "./message.service";

/** 向会话、Memory 和统一分析模块提供同一个消息持久化服务。 */
@Module({
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
