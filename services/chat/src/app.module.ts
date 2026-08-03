import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { ConversationModule } from "./conversation/conversation.module";
import { DocumentModule } from "./document/document.module";
import { AdvancedModule } from "./llm/advanced.module";
import { LlmModule } from "./llm/llm.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SseModule } from "./sse/sse.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { PermissionsModule } from "./permissions/permissions.module";

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    SseModule,
    ConversationModule,
    LlmModule,
    AdvancedModule,
    DocumentModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
