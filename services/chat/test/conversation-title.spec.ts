import { describe, expect, it, vi } from "vitest";
import { MessageRole } from "../src/database/schema";
import { ConversationService } from "../src/conversation/conversation.service";
import {
  createConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "../src/conversation/conversation-title";
import { MessageService } from "../src/message/message.service";
import { createDatabaseMock } from "./drizzle-test-utils";

describe("conversation title", () => {
  it("uses the first message and keeps the title short", () => {
    expect(
      createConversationTitle(
        "  开发一个面向需求分析师的会话记忆系统\n支持多轮澄清  ",
      ),
    ).toBe("开发一个面向需求分析师的会话记忆系统 支持多轮澄清");

    expect(createConversationTitle("你好")).toBe("你好");
    expect(createConversationTitle(" ")).toBe(DEFAULT_CONVERSATION_TITLE);
    expect(createConversationTitle("一".repeat(40))).toBe(
      `${"一".repeat(27)}…`,
    );
  });

  it("derives display titles for legacy conversations still named 新会话", async () => {
    const database = createDatabaseMock({
      select: [[
        {
          conversation: {
            id: "conversation-1",
            userId: "user-1",
            title: DEFAULT_CONVERSATION_TITLE,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          firstMessage: "分析用户登录需求",
        },
      ]],
    });
    const service = new ConversationService(database);

    const conversations = await service.findByUser("user-1");

    expect(conversations[0]?.title).toBe("分析用户登录需求");
    expect(conversations[0]).not.toHaveProperty("messages");
  });

  it("persists the generated title when the first user message is added", async () => {
    const database = createDatabaseMock({
      select: [[{ title: DEFAULT_CONVERSATION_TITLE }]],
      returning: [[{ id: "message-1" }]],
    });
    const service = new MessageService(database);

    await service.addMessage(
      "conversation-1",
      MessageRole.USER,
      "  我要做一个订单查询功能\n支持按手机号搜索  ",
    );

    expect((database.db.update as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
