import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { ConversationModule } from "./conversation/conversation.module";
import { DocumentModule } from "./document/document.module";
import { AdvancedModule } from "./llm/advanced.module";
import { LlmModule } from "./llm/llm.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SseModule } from "./sse/sse.module";

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    SseModule,
    ConversationModule,
    LlmModule,
    AdvancedModule,
    DocumentModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
