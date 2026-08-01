import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

/**
 * Nest 全局 Prisma 客户端，使用 Prisma 7 的 PostgreSQL 驱动适配器。
 * 连接地址只从 DATABASE_URL 读取，并跟随 Nest 模块生命周期建立和释放连接。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize Prisma");
    }

    super({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  /** Nest 模块初始化后建立数据库连接，使启动阶段即可暴露连接错误。 */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Nest 应用关闭时主动释放 PostgreSQL 连接池。 */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
