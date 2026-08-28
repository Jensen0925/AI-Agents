import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { conversations, type JsonValue, MessageRole, type MessageRole as MessageRoleValue, messages } from "../database/schema";
import {
  createConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "../conversation/conversation-title";

/** 负责会话消息持久化，并在数据库消息与 LangChain 消息之间转换。 */
@Injectable()
export class MessageService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 在事务中新增消息并刷新会话 updatedAt，保证会话排序与消息写入一致。
   */
  addMessage(
    conversationId: string,
    role: MessageRoleValue,
    content: string,
    metadata?: JsonValue,
  ) {
    return this.database.db.transaction(async (transaction) => {
      const [message] = await transaction.insert(messages).values({ id: crypto.randomUUID(), conversationId, role, content, metadata }).returning();

      // 首条用户消息作为会话标题，后续消息不再覆盖用户已经看到的名称。
      const conversation =
        role === MessageRole.USER
          ? (await transaction.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, conversationId)).limit(1))[0]
          : null;
      const title = conversation?.title?.trim();

      await transaction.update(conversations).set({ updatedAt: new Date(), ...(title === DEFAULT_CONVERSATION_TITLE ? { title: createConversationTitle(content) } : {}) }).where(eq(conversations.id, conversationId));
      return message!;
    });
  }

  /**
   * 返回按时间正序排列的历史消息；limit 被限制在 1 到 500 之间。
   * 查询先按倒序截取最近记录，再反转为对话使用的自然顺序。
   */
  async getHistory(conversationId: string, limit?: number) {
    const take =
      typeof limit === "number"
        ? Math.min(500, Math.max(1, Math.floor(limit)))
        : undefined;
    const history = await this.database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(take ?? 500);

    return history.reverse();
  }

  /** 将数据库 USER/ASSISTANT 角色转换为 LangChain HumanMessage/AIMessage。 */
  async getHistoryAsLangChainMessages(
    conversationId: string,
  ): Promise<BaseMessage[]> {
    const history = await this.getHistory(conversationId);
    return history.map((message) =>
      message.role === MessageRole.USER
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    );
  }

  /** 清空指定会话的全部消息，保留会话本身。 */
  async clearHistory(conversationId: string): Promise<void> {
    await this.database.db.delete(messages).where(eq(messages.conversationId, conversationId));
  }
}
