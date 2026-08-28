import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { Response } from "express";
import { createChatModel } from "../llm/model.factory";
import { DatabaseService, type Database } from "../database/database.service";
import { artifacts, artifactVersions, ArtifactType, conversations } from "../database/schema";

export interface UpsertArtifactInput {
  conversationId: string;
  userId: string;
  title: string;
  content: string;
  type?: ArtifactType;
  language?: string;
  sourceMessageId?: string;
}

export interface UpdateArtifactInput {
  content: string;
  changelog?: string;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return String(value ?? "");
}

/**
 * 报告工件允许在滚动发布期间晚于应用代码迁移。只有工件自身表不存在时
 * 才将它视为可选功能不可用；其它数据库错误（权限、连接、数据约束等）
 * 必须继续向上抛出，避免掩盖真实故障。
 */
function isArtifactSchemaUnavailable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== undefined && candidate.code !== "42P01") return false;
  const message = error instanceof Error ? error.message : String(candidate.message ?? error);
  return /relation ["']?(artifacts|artifact_versions)["']? does not exist/i.test(message);
}

/**
 * 管理会话内唯一的报告工件及其版本。所有公开读取和写入入口都以
 * conversationId + userId 为权限边界，避免仅凭 artifactId 越权访问。
 */
@Injectable()
export class ArtifactService {
  constructor(private readonly database: DatabaseService) {}

  private async loadArtifact(artifactId: string, userId: string) {
    const [artifact] = await this.database.db.select().from(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.userId, userId))).limit(1);
    if (!artifact) throw new NotFoundException("Artifact not found");
    return artifact;
  }

  private async withVersions(
    db: Pick<Database, "select">,
    artifact: typeof artifacts.$inferSelect,
  ) {
    const versions = await db.select().from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifact.id))
      .orderBy(desc(artifactVersions.version))
      .limit(10);
    return { ...artifact, versions };
  }

  async upsertGeneratedReport(input: UpsertArtifactInput) {
    await this.assertConversationOwner(input.conversationId, input.userId);
    const [existing] = await this.database.db.select().from(artifacts)
      .where(eq(artifacts.conversationId, input.conversationId)).limit(1);

    if (!existing) {
      return this.database.db.transaction(async (transaction) => {
        const [artifact] = await transaction.insert(artifacts).values({
          id: crypto.randomUUID(), conversationId: input.conversationId, userId: input.userId,
          title: input.title, content: input.content, type: input.type ?? ArtifactType.MARKDOWN,
          language: input.language, currentVersion: 1, updatedAt: new Date(),
        }).returning();
        await transaction.insert(artifactVersions).values({
          id: crypto.randomUUID(), artifactId: artifact!.id, version: 1, content: input.content,
          sourceTags: ["AI"], sourceMessageId: input.sourceMessageId,
        });
        await transaction.update(conversations).set({ title: input.title, updatedAt: new Date() })
          .where(eq(conversations.id, input.conversationId));
        return this.withVersions(transaction, artifact!);
      });
    }

    const nextVersion = existing.currentVersion + 1;
    return this.database.db.transaction(async (transaction) => {
      const [artifact] = await transaction.update(artifacts).set({ title: input.title, content: input.content,
        type: input.type ?? existing.type, language: input.language ?? existing.language,
        currentVersion: nextVersion, updatedAt: new Date() }).where(eq(artifacts.id, existing.id)).returning();
      await transaction.insert(artifactVersions).values({ id: crypto.randomUUID(), artifactId: existing.id,
        version: nextVersion, content: input.content, changelog: "AI 重新生成分析报告", sourceTags: ["AI"], sourceMessageId: input.sourceMessageId });
      await transaction.update(conversations).set({ title: input.title, updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
      return this.withVersions(transaction, artifact!);
    });
  }

  async findByConversation(conversationId: string, userId: string) {
    await this.assertConversationOwner(conversationId, userId);
    try {
      const [artifact] = await this.database.db.select().from(artifacts).where(and(eq(artifacts.conversationId, conversationId), eq(artifacts.userId, userId))).limit(1);
      return artifact ? this.withVersions(this.database.db, artifact) : null;
    } catch (error) {
      if (!isArtifactSchemaUnavailable(error)) throw error;
      // 新旧服务版本交叠时，读取工件不能干扰主聊天流程。迁移完成后下一次
      // 请求会自然恢复为正常查询，无需重启或清理缓存。
      console.warn("[ArtifactService] Artifact tables are not deployed; report workspace is unavailable");
      return null;
    }
  }

  async findById(artifactId: string, userId: string) {
    return this.loadArtifact(artifactId, userId);
  }

  async updateArtifact(
    artifactId: string,
    userId: string,
    input: UpdateArtifactInput,
  ) {
    const artifact = await this.findById(artifactId, userId);
    const nextVersion = artifact.currentVersion + 1;
    return this.database.db.transaction(async (transaction) => {
      const [updated] = await transaction.update(artifacts).set({ content: input.content, currentVersion: nextVersion, updatedAt: new Date() }).where(eq(artifacts.id, artifactId)).returning();
      await transaction.insert(artifactVersions).values({ id: crypto.randomUUID(), artifactId, version: nextVersion, content: input.content, changelog: input.changelog?.trim() || "人工编辑报告", sourceTags: ["HUMAN"] });
      return this.withVersions(transaction, updated!);
    });
  }

  async updateTitle(artifactId: string, userId: string, title: string) {
    const artifact = await this.findById(artifactId, userId);
    return this.database.db.transaction(async (transaction) => {
      const [updated] = await transaction.update(artifacts).set({ title, updatedAt: new Date() }).where(eq(artifacts.id, artifact.id)).returning();
      await transaction.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, artifact.conversationId));
      return updated!;
    });
  }

  async getVersions(artifactId: string, userId: string) {
    await this.findById(artifactId, userId);
    return this.database.db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifactId)).orderBy(desc(artifactVersions.version));
  }

  async revertToVersion(
    artifactId: string,
    userId: string,
    targetVersion: number,
  ) {
    const artifact = await this.findById(artifactId, userId);
    const [version] = await this.database.db.select().from(artifactVersions).where(and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, targetVersion))).limit(1);
    if (!version) throw new NotFoundException("Artifact version not found");

    const nextVersion = artifact.currentVersion + 1;
    return this.database.db.transaction(async (transaction) => {
      const [updated] = await transaction.update(artifacts).set({ content: version.content, currentVersion: nextVersion, updatedAt: new Date() }).where(eq(artifacts.id, artifactId)).returning();
      await transaction.insert(artifactVersions).values({ id: crypto.randomUUID(), artifactId, version: nextVersion, content: version.content, changelog: `恢复到版本 ${targetVersion}`, sourceTags: ["HUMAN", "REVERT"] });
      return this.withVersions(transaction, updated!);
    });
  }

  async deleteArtifact(artifactId: string, userId: string): Promise<void> {
    await this.findById(artifactId, userId);
    await this.database.db.delete(artifacts).where(eq(artifacts.id, artifactId));
  }

  /**
   * 将优化后的完整报告通过 SSE 发送，并且仅在生成完成后创建一个版本。
   * 任一模型错误都会以 SSE error 事件返回，普通聊天接口不依赖这条能力。
   */
  async optimizeArtifactStream(
    artifactId: string,
    userId: string,
    instruction: string,
    response: Response,
  ): Promise<void> {
    const artifact = await this.findById(artifactId, userId);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      const model = createChatModel({ reasoningEffort: "medium" });
      const prompt = [
        "你是专业的需求分析报告编辑。只按用户指令优化报告，保留正确内容、Markdown 标题层级和代码块。",
        "直接返回优化后的完整 Markdown 报告，不要解释修改过程。",
        `用户指令：${instruction}`,
        `原报告：\n${artifact.content}`,
      ].join("\n\n");
      let content = "";
      const stream = await model.stream(prompt);
      for await (const chunk of stream) {
        const delta = text(chunk.content);
        if (!delta) continue;
        content += delta;
        response.write(`data: ${JSON.stringify({ type: "markdown", content: delta })}\n\n`);
      }

      if (!content.trim()) {
        throw new Error("模型未返回可保存的报告内容");
      }
      const updated = await this.updateArtifact(artifactId, userId, {
        content,
        changelog: `AI 优化：${instruction}`,
      });
      response.write(`data: ${JSON.stringify({ type: "done", version: updated.currentVersion })}\n\n`);
    } catch (error) {
      response.write(
        `data: ${JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "Artifact optimization failed",
        })}\n\n`,
      );
    } finally {
      response.end();
    }
  }

  private async assertConversationOwner(conversationId: string, userId: string) {
    const [conversation] = await this.database.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }
}
