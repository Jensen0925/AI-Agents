import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
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
import { AllExceptionsFilter } from "./observability/all-exceptions.filter";
import { ResponseInterceptor } from "./observability/response.interceptor";
import { TraceMiddleware } from "./observability/trace.middleware";
import { closeMcp, initMcp } from "./mcp/mcp-bootstrap";

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
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule
  implements NestModule, OnApplicationBootstrap, OnApplicationShutdown
{
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes("*");
  }

  onApplicationBootstrap(): void {
    // MCP 连接属于增强能力；Server 未安装或外部服务不可用时，本地专家工具继续可用。
    void initMcp();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeMcp();
  }
}
