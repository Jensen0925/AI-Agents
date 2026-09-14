import { ConflictException } from "@nestjs/common";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { isUniqueViolation, pgErrorCode } from "../src/database/pg-errors";
import {
  categories,
  conversations,
  documentChunks,
  documents,
  messages,
  MessageRole,
  roles,
  userRoles,
  users,
  UserStatus,
} from "../src/database/schema";
import { CategoryService } from "../src/document/category.service";
import { EMBEDDING_DIMENSION } from "../src/llm/embedding/model";
import { UsersService } from "../src/users/users.service";

/**
 * 只从 services/chat/.env 补齐 DATABASE_URL。
 *
 * 测试进程默认不读 .env；也不能整份注入——那会把模型密钥塞进其他用例，
 * 让本该离线运行的测试真的去打外部接口。
 */
function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    if (line.slice(0, separatorIndex).trim() !== "DATABASE_URL") continue;
    process.env.DATABASE_URL = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    return;
  }
}

loadDatabaseUrl();

/**
 * 真实 PostgreSQL 集成测试。
 *
 * 默认跳过，需要同时满足：
 *   1. `DATABASE_URL` 指向已执行迁移的 pgvector 实例；
 *   2. 显式设置 `RUN_DB_INTEGRATION=1`（CI 的 retrieval-eval 任务已具备该条件）。
 *
 * 为什么必须连真库：内存替身把 `transaction` 直接透传、对 db.execute 返回裸数组，
 * 于是「级联删除」「唯一约束」「vector 维度约束」「驱动把错误包在 cause 上」这些
 * 只在数据库层成立的语义全都测不到。本文件第二个用例就是被真库暴露出来的真实缺陷：
 * drizzle 包装错误后，只检查顶层 `error.code` 的 23505 分支永远不会命中。
 */
const ENABLED =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

const PREFIX = "db-integration-";
const USER_ID = `${PREFIX}user-1`;

function fixtureId(suffix: string): string {
  return `${PREFIX}${suffix}`;
}

const database = new DatabaseService();

/** 清掉本套件写过的所有行；documents 级联删除 document_chunks，users 级联 user_roles。 */
async function cleanup(): Promise<void> {
  const likePrefix = sql`${`${PREFIX}%`}`;
  // 服务层创建的用户/分类用随机 uuid 作主键，只能按业务字段（邮箱/归属用户）识别。
  await database.db.delete(users).where(sql`${users.email} LIKE ${likePrefix}`);
  await database.db.delete(roles).where(sql`${roles.code} LIKE ${likePrefix}`);
  await database.db
    .delete(categories)
    .where(sql`${categories.userId} LIKE ${likePrefix}`);
  await database.db
    .delete(documents)
    .where(sql`${documents.id} LIKE ${likePrefix}`);
  await database.db
    .delete(conversations)
    .where(sql`${conversations.id} LIKE ${likePrefix}`);
}

describe.skipIf(!ENABLED)("PostgreSQL 集成（真实数据库语义）", () => {
  beforeAll(async () => {
    await database.connect();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await database.disconnect();
  });

  it("唯一约束冲突能被识别：驱动错误被 drizzle 包在 cause 上", async () => {
    const email = `${PREFIX}dup@example.com`;
    await database.db.insert(users).values({
      id: fixtureId("dup-a"),
      email,
      name: "dup-a",
      passwordHash: "x",
      updatedAt: new Date(),
    });

    const error = await database.db
      .insert(users)
      .values({
        id: fixtureId("dup-b"),
        email,
        name: "dup-b",
        passwordHash: "x",
        updatedAt: new Date(),
      })
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    // drizzle 把 pg 的 DatabaseError 包进 DrizzleQueryError，顶层没有 code。
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(error)).toBe("23505");
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("UsersService 在重复邮箱上返回 409 而不是 500", async () => {
    const service = new UsersService(database);
    const email = `${PREFIX}service@example.com`;
    await service.create({ email, name: "首个用户", password: "Cloudsage@2026" });

    await expect(
      service.create({ email, name: "重复用户", password: "Cloudsage@2026" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("CategoryService 在同名分类上返回 400 而不是 500", async () => {
    const service = new CategoryService(database);
    await service.create(USER_ID, "集成测试分类");

    await expect(service.create(USER_ID, "集成测试分类")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("删除会话级联清空消息", async () => {
    const conversationId = fixtureId("cascade-conversation");
    await database.db.insert(conversations).values({
      id: conversationId,
      userId: USER_ID,
      title: "级联删除",
      updatedAt: new Date(),
    });
    await database.db.insert(messages).values([
      {
        id: fixtureId("cascade-message-1"),
        conversationId,
        role: MessageRole.USER,
        content: "第一条",
      },
      {
        id: fixtureId("cascade-message-2"),
        conversationId,
        role: MessageRole.ASSISTANT,
        content: "第二条",
      },
    ]);

    await database.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId));

    const [remaining] = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    expect(remaining?.count).toBe(0);
  });

  it("vector(384) 列拒绝维度不符的向量", async () => {
    const documentId = fixtureId("dimension-document");
    await database.db.insert(documents).values({
      id: documentId,
      userId: USER_ID,
      filename: "dimension.txt",
      mimeType: "text/plain",
      size: 0,
      status: "processed",
    });

    const error = await database.db
      .insert(documentChunks)
      .values({
        id: fixtureId("dimension-chunk"),
        documentId,
        content: "维度校验",
        chunkIndex: 0,
        embedding: [0.1, 0.2, 0.3],
      })
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(error).toBeDefined();

    // 补齐到模型维度后写入成功，证明失败原因确实来自维度而不是其他约束。
    await database.db.insert(documentChunks).values({
      id: fixtureId("dimension-chunk-ok"),
      documentId,
      content: "维度正确",
      chunkIndex: 1,
      embedding: Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / 1000),
    });
  });

  it("HNSW 向量索引已由迁移创建", async () => {
    const result = (await database.db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'document_chunks' AND indexdef ILIKE '%hnsw%'`,
    )) as unknown as { rows: { indexdef: string }[] };
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.indexdef).toContain("vector_cosine_ops");
  });

  it("事务在失败时整体回滚，不留半成品行", async () => {
    const roleId = fixtureId("rollback-role");
    await expect(
      database.db.transaction(async (transaction) => {
        await transaction.insert(roles).values({
          id: roleId,
          code: `${PREFIX}rollback`,
          name: "回滚用例",
          updatedAt: new Date(),
        });
        throw new Error("触发回滚");
      }),
    ).rejects.toThrow("触发回滚");

    const [row] = await database.db
      .select()
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it("条件更新把并发处理收敛为单次", async () => {
    const documentId = fixtureId("conditional-document");
    await database.db.insert(documents).values({
      id: documentId,
      userId: USER_ID,
      filename: "conditional.txt",
      mimeType: "text/plain",
      size: 0,
      filePath: "uploads/conditional.txt",
      status: "pending",
    });

    const claim = () =>
      database.db
        .update(documents)
        .set({ status: "processing", chunkCount: 0 })
        .where(
          and(eq(documents.id, documentId), ne(documents.status, "processing")),
        )
        .returning({ id: documents.id });

    const claimed = await Promise.all([claim(), claim()]);
    expect(claimed[0].length + claimed[1].length).toBe(1);
  });

  it("最后一个启用状态的超管不可删除（其余超管临时停用后恢复）", async () => {
    const service = new UsersService(database);
    const admin = await service.create({
      email: `${PREFIX}last-admin@example.com`,
      name: "唯一超管",
      password: "Cloudsage@2026",
      status: UserStatus.ACTIVE,
    });
    const [role] = await database.db
      .select()
      .from(roles)
      .where(eq(roles.code, "super_admin"))
      .limit(1);
    expect(role).toBeDefined();
    await database.db
      .insert(userRoles)
      .values({ userId: admin.id, roleId: role!.id });

    // 删除自己必须先被自锁保护挡住，与库里其他超管数量无关。
    await expect(service.remove(admin.id, admin.id)).rejects.toMatchObject({
      status: 400,
    });

    const others = await database.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(roles.code, "super_admin"),
          ne(users.id, admin.id),
          eq(users.status, UserStatus.ACTIVE),
        ),
      );
    const otherIds = others.map((row) => row.id);
    try {
      if (otherIds.length > 0) {
        // 临时停用其他超管，让「最后一个超管」这个分支可确定地命中。
        await database.db
          .update(users)
          .set({ status: UserStatus.DISABLED })
          .where(inArray(users.id, otherIds));
      }
      await expect(
        service.remove(admin.id, `${PREFIX}other-actor`),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      if (otherIds.length > 0) {
        await database.db
          .update(users)
          .set({ status: UserStatus.ACTIVE })
          .where(inArray(users.id, otherIds));
      }
    }
  });
});
