import { describe, expect, it, mock } from "bun:test";
import { ArtifactType } from "@prisma/client";
import { NotFoundException } from "@nestjs/common";
import { ArtifactService } from "../src/artifact/artifact.service";
import type { PrismaService } from "../src/prisma/prisma.service";

function artifactRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    conversationId: "conversation-1",
    userId: "user-1",
    title: "登录需求分析",
    type: ArtifactType.MARKDOWN,
    language: null,
    content: "初版报告",
    currentVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Chapter 19 artifact service", () => {
  it("creates a versioned artifact for the first generated report", async () => {
    const created = artifactRecord({ versions: [{ version: 1 }] });
    const transaction = {
      artifact: { create: mock(async () => created) },
      conversation: { update: mock(async () => ({ id: "conversation-1" })) },
    };
    const prisma = {
      conversation: { findFirst: mock(async () => ({ id: "conversation-1" })) },
      artifact: { findUnique: mock(async () => null) },
      $transaction: mock(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await service.upsertGeneratedReport({
      conversationId: "conversation-1",
      userId: "user-1",
      title: "登录需求分析",
      content: "## 需求摘要",
    });

    expect(transaction.artifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: "conversation-1",
        userId: "user-1",
        currentVersion: 1,
        versions: {
          create: expect.objectContaining({
            version: 1,
            content: "## 需求摘要",
            sourceTags: ["AI"],
          }),
        },
      }),
      include: { versions: true },
    });
    expect(transaction.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { title: "登录需求分析" },
    });
  });

  it("creates a new immutable version when a report is regenerated", async () => {
    const existing = artifactRecord({ currentVersion: 3 });
    const transaction = {
      artifact: { update: mock(async () => artifactRecord({ currentVersion: 4 })) },
      conversation: { update: mock(async () => ({ id: "conversation-1" })) },
    };
    const prisma = {
      conversation: { findFirst: mock(async () => ({ id: "conversation-1" })) },
      artifact: { findUnique: mock(async () => existing) },
      $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await service.upsertGeneratedReport({
      conversationId: "conversation-1",
      userId: "user-1",
      title: "新版报告",
      content: "新的分析结论",
    });

    expect(transaction.artifact.update).toHaveBeenCalledWith({
      where: { id: "artifact-1" },
      data: expect.objectContaining({
        currentVersion: 4,
        versions: {
          create: expect.objectContaining({
            version: 4,
            sourceTags: ["AI"],
          }),
        },
      }),
      include: { versions: true },
    });
  });

  it("does not expose an artifact that belongs to another user", async () => {
    const findFirst = mock(async () => null);
    const prisma = {
      artifact: { findFirst },
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await expect(service.findById("artifact-1", "other-user")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "artifact-1", userId: "other-user" },
    });
  });

  it("returns no artifact when the optional artifact tables have not been migrated", async () => {
    const missingTable = Object.assign(new Error("The table public.artifacts does not exist"), {
      code: "P2021",
      meta: { table: "public.artifacts" },
    });
    const prisma = {
      conversation: { findFirst: mock(async () => ({ id: "conversation-1" })) },
      artifact: { findFirst: mock(async () => { throw missingTable; }) },
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await expect(service.findByConversation("conversation-1", "user-1")).resolves.toBeNull();
  });

  it("does not hide unrelated database failures when loading artifacts", async () => {
    const prisma = {
      conversation: { findFirst: mock(async () => ({ id: "conversation-1" })) },
      artifact: { findFirst: mock(async () => { throw new Error("database connection lost"); }) },
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await expect(service.findByConversation("conversation-1", "user-1")).rejects.toThrow(
      "database connection lost",
    );
  });

  it("reverting a version creates a new human-owned snapshot", async () => {
    const artifact = artifactRecord({ currentVersion: 2 });
    const target = {
      id: "version-1",
      artifactId: "artifact-1",
      version: 1,
      content: "初版报告",
    };
    const update = mock(async () => artifactRecord({ currentVersion: 3, content: "初版报告" }));
    const prisma = {
      artifact: { findFirst: mock(async () => artifact), update },
      artifactVersion: { findUnique: mock(async () => target) },
    } as unknown as PrismaService;
    const service = new ArtifactService(prisma);

    await service.revertToVersion("artifact-1", "user-1", 1);

    expect(update).toHaveBeenCalledWith({
      where: { id: "artifact-1" },
      data: expect.objectContaining({
        content: "初版报告",
        currentVersion: 3,
        versions: {
          create: expect.objectContaining({
            version: 3,
            changelog: "恢复到版本 1",
            sourceTags: ["HUMAN", "REVERT"],
          }),
        },
      }),
      include: { versions: true },
    });
  });
});
