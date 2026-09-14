import "./env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { assertAuthSecretsConfigured } from "./auth/token";
import { AppModule } from "./app.module";

async function bootstrap() {
  // 配置错误必须在启动阶段就失败，而不是在首次登录时变成语义不明的 500。
  assertAuthSecretsConfigured();

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3002").split(","),
    credentials: true,
  });
  // 必须显式开启：否则 onModuleDestroy / onApplicationShutdown 永不执行，
  // DatabaseService 的连接池、MCP stdio 子进程与 checkpointer 连接池都会在
  // SIGTERM 时被硬断，滚动更新会持续累积孤儿连接与进程。
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
