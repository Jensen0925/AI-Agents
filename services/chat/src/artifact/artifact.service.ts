import { ArtifactType } from "@prisma/client";
import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Response } from "express";
import { createChatModel } from "../llm/model.factory";
import { PrismaService } from "../prisma/prisma.service";

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
 * 才将它视为可选功能不可用；其它 Prisma 错误（权限、连接、数据约束等）
 * 必须继续向上抛出，避免掩盖真实故障。
 */
function isArtifactSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const prismaError = error as {
    code?: unknown;
    meta?: { table?: unknown };
    message?: unknown;
  };
  if (prismaError.code !== "P2021") return false;

  const detail = [
    typeof prismaError.meta?.table === "string" ? prismaError.meta.table : "",
    typeof prismaError.message === "string" ? prismaError.message : "",
  ]
    .join(" ")
    .toLowerCase();

  return detail.includes("artifacts") || detail.includes("artifact_versions");
}

/**
 * 管理会话内唯一的报告工件及其版本。所有公开读取和写入入口都以
 * conversationId + userId 为权限边界，避免仅凭 artifactId 越权访问。
 */
@Injectable()
export class ArtifactService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertGeneratedReport(input: UpsertArtifactInput) {
    await this.assertConversationOwner(input.conversationId, input.userId);
    const existing = await this.prisma.artifact.findUnique({
      where: { conversationId: input.conversationId },
    });

    if (!existing) {
      return this.prisma.$transaction(async (transaction) => {
        const artifact = await transaction.artifact.create({
          data: {
            conversationId: input.conversationId,
            userId: input.userId,
            title: input.title,
            content: input.content,
            type: input.type ?? ArtifactType.MARKDOWN,
            language: input.language,
            currentVersion: 1,
            versions: {
              create: {
                version: 1,
                content: input.content,
                sourceTags: ["AI"],
                sourceMessageId: input.sourceMessageId,
              },
            },
          },
          include: { versions: true },
        });
        await transaction.conversation.update({
          where: { id: input.conversationId },
          data: { title: input.title },
        });
        return artifact;
      });
    }

    const nextVersion = existing.currentVersion + 1;
    return this.prisma.$transaction(async (transaction) => {
      const artifact = await transaction.artifact.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          content: input.content,
          type: input.type ?? existing.type,
          language: input.language ?? existing.language,
          currentVersion: nextVersion,
          versions: {
            create: {
              version: nextVersion,
              content: input.content,
              changelog: "AI 重新生成分析报告",
              sourceTags: ["AI"],
              sourceMessageId: input.sourceMessageId,
            },
          },
        },
        include: { versions: true },
      });
      await transaction.conversation.update({
        where: { id: input.conversationId },
        data: { title: input.title },
      });
      return artifact;
    });
  }

  async findByConversation(conversationId: string, userId: string) {
    await this.assertConversationOwner(conversationId, userId);
    try {
      return await this.prisma.artifact.findFirst({
        where: { conversationId, userId },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 10,
          },
        },
      });
    } catch (error) {
      if (!isArtifactSchemaUnavailable(error)) throw error;
      // 新旧服务版本交叠时，读取工件不能干扰主聊天流程。迁移完成后下一次
      // 请求会自然恢复为正常查询，无需重启或清理缓存。
      console.warn("[ArtifactService] Artifact tables are not deployed; report workspace is unavailable");
      return null;
    }
  }

  async findById(artifactId: string, userId: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { id: artifactId, userId },
    });
    if (!artifact) throw new NotFoundException("Artifact not found");
    return artifact;
  }

  async updateArtifact(
    artifactId: string,
    userId: string,
    input: UpdateArtifactInput,
  ) {
    const artifact = await this.findById(artifactId, userId);
    const nextVersion = artifact.currentVersion + 1;
    return this.prisma.artifact.update({
      where: { id: artifactId },
      data: {
        content: input.content,
        currentVersion: nextVersion,
        versions: {
          create: {
            version: nextVersion,
            content: input.content,
            changelog: input.changelog?.trim() || "人工编辑报告",
            sourceTags: ["HUMAN"],
          },
        },
      },
      include: { versions: true },
    });
  }

  async updateTitle(artifactId: string, userId: string, title: string) {
    const artifact = await this.findById(artifactId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.artifact.update({
        where: { id: artifact.id },
        data: { title },
      });
      await transaction.conversation.update({
        where: { id: artifact.conversationId },
        data: { title },
      });
      return updated;
    });
  }

  async getVersions(artifactId: string, userId: string) {
    await this.findById(artifactId, userId);
    return this.prisma.artifactVersion.findMany({
      where: { artifactId },
      orderBy: { version: "desc" },
    });
  }

  async revertToVersion(
    artifactId: string,
    userId: string,
    targetVersion: number,
  ) {
    const artifact = await this.findById(artifactId, userId);
    const version = await this.prisma.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId, version: targetVersion } },
    });
    if (!version) throw new NotFoundException("Artifact version not found");

    const nextVersion = artifact.currentVersion + 1;
    return this.prisma.artifact.update({
      where: { id: artifactId },
      data: {
        content: version.content,
        currentVersion: nextVersion,
        versions: {
          create: {
            version: nextVersion,
            content: version.content,
            changelog: `恢复到版本 ${targetVersion}`,
            sourceTags: ["HUMAN", "REVERT"],
          },
        },
      },
      include: { versions: true },
    });
  }

  async deleteArtifact(artifactId: string, userId: string): Promise<void> {
    await this.findById(artifactId, userId);
    await this.prisma.artifact.delete({ where: { id: artifactId } });
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
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }
}
