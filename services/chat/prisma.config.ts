import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

loadEnvFile();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    // Prisma 7 从配置文件读取连接串，schema.prisma 不再声明 url。
    url: process.env["DATABASE_URL"],
  },
});
