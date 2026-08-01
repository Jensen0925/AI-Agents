import { Module } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AdvancedModule } from "../llm/advanced.module";
import { MessageModule } from "../message/message.module";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "./conversation.service";

@Module({
  imports: [AdvancedModule, MessageModule],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    JwtAuthGuard,
  ],
  exports: [ConversationService],
})
export class ConversationModule {}
