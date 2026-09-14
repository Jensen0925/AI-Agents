import { describe, expect, it, vi } from "vitest";
import { MessageRole } from "../src/database/schema";
import {
  ConversationService,
  MAX_CONVERSATION_PAGE_SIZE,
} from "../src/conversation/conversation.service";
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
      select: [
        [
          {
            id: "conversation-1",
            userId: "user-1",
            title: DEFAULT_CONVERSATION_TITLE,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        [{ conversationId: "conversation-1", content: "分析用户登录需求" }],
      ],
    });
    const service = new ConversationService(database);

    const conversations = await service.findByUser("user-1");

    expect(conversations[0]?.title).toBe("分析用户登录需求");
    expect(conversations[0]).not.toHaveProperty("messages");
  });

  it("分页落在会话行上：limit/offset 直接传给会话查询，不做内存去重", async () => {
    const database = createDatabaseMock({
      select: [
        [
          { id: "c-2", userId: "user-1", title: "已命名会话", createdAt: new Date(), updatedAt: new Date() },
          { id: "c-1", userId: "user-1", title: "另一个会话", createdAt: new Date(), updatedAt: new Date() },
        ],
      ],
    });
    const service = new ConversationService(database);

    const conversations = await service.findByUser("user-1", { limit: 2, offset: 20 });

    expect(conversations.map((conversation) => conversation.id)).toEqual(["c-2", "c-1"]);
    // 标题都已持久化，不需要再查首条消息。
    expect(database.db.selectDistinctOn).not.toHaveBeenCalled();
    const selection = (database.db.select as ReturnType<typeof vi.fn>).mock.results[0]!
      .value as Record<string, ReturnType<typeof vi.fn>>;
    expect(selection.limit).toHaveBeenCalledWith(2);
    expect(selection.offset).toHaveBeenCalledWith(20);
  });

  it("会话列表不受条数上限之外的放大：limit 超过上限时被收敛", async () => {
    const database = createDatabaseMock({ select: [[]] });
    const service = new ConversationService(database);

    await service.findByUser("user-1", { limit: 10_000 });

    const selection = (database.db.select as ReturnType<typeof vi.fn>).mock.results[0]!
      .value as Record<string, ReturnType<typeof vi.fn>>;
    expect(selection.limit).toHaveBeenCalledWith(MAX_CONVERSATION_PAGE_SIZE);
    expect(database.db.selectDistinctOn).not.toHaveBeenCalled();
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
