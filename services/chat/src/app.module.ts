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
import { DatabaseModule } from "./database/database.module";
import { SseModule } from "./sse/sse.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { SecurityModule } from "./security/security.module";
import { AllExceptionsFilter } from "./observability/all-exceptions.filter";
import { ResponseInterceptor } from "./observability/response.interceptor";
import { TraceMiddleware } from "./observability/trace.middleware";
import { closeMcp, initMcp } from "./mcp/mcp-bootstrap";
import { disposeSharedCheckpointer } from "./llm/graph/checkpointer.provider";

@Module({
  imports: [
    DatabaseModule,
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
    SecurityModule,
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
    // 关闭顺序：先断开 MCP 子进程，再释放 LangGraph checkpointer 连接池。
    // 任一环节失败都不能阻断另一个，否则重启会留下孤儿进程/连接。
    try {
      await closeMcp();
    } catch (error) {
      console.error("[shutdown] closeMcp failed", error);
    }
    try {
      await disposeSharedCheckpointer();
    } catch (error) {
      console.error("[shutdown] disposeSharedCheckpointer failed", error);
    }
  }
}
