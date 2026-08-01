import { describe, expect, it, mock } from "bun:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { ConversationController } from "../src/conversation/conversation.controller";
import { ConversationService } from "../src/conversation/conversation.service";
import type { AdvancedAnalysisService } from "../src/llm/advanced-analysis.service";
import type { MessageService } from "../src/message/message.service";
import type { PrismaService } from "../src/prisma/prisma.service";

describe("ConversationService", () => {
  it("filters conversation lookup by both conversationId and userId", async () => {
    const findFirst = mock(async () => ({
      id: "conversation-1",
      userId: "user-1",
      title: "需求分析",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const prisma = {
      conversation: { findFirst },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    await service.findById("conversation-1", "user-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "conversation-1",
        userId: "user-1",
      },
    });
  });

  it("does not reveal whether another user's conversation exists", async () => {
    const prisma = {
      conversation: { findFirst: mock(async () => null) },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    await expect(
      service.findById("conversation-1", "another-user"),
    ).rejects.toThrow("Conversation not found");
  });
});

describe("ConversationController", () => {
  it("protects every conversation route with JwtAuthGuard", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ConversationController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  it("routes conversation chat through the unified analysis service", async () => {
    const findById = mock(async () => ({ id: "conversation-1" }));
    const analyze = mock(
      async (_userId: string, _conversationId: string, _input: string) => ({
        report: "需求分析报告",
        usedAgents: ["extractAgent" as const],
        retrievedDocuments: [],
      }),
    );
    const controller = new ConversationController(
      { findById } as unknown as ConversationService,
      {} as MessageService,
      { analyze } as unknown as AdvancedAnalysisService,
    );

    const result = await controller.chat(
      { headers: {}, user: { userId: "user-1" } },
      "conversation-1",
      { input: "分析这个需求" },
    );

    expect(findById).toHaveBeenCalledWith("conversation-1", "user-1");
    expect(analyze).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      "分析这个需求",
    );
    expect(result.report).toBe("需求分析报告");
  });
});
