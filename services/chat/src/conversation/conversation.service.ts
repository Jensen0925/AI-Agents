import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { conversations, messages, MessageRole } from "../database/schema";
import {
  createConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "./conversation-title";

/** 会话列表默认条数与单次上限，避免一次拉回全部会话。 */
export const DEFAULT_CONVERSATION_PAGE_SIZE = 100;
export const MAX_CONVERSATION_PAGE_SIZE = 200;

/** 管理用户会话，并在所有单条记录操作中强制校验会话归属。 */
@Injectable()
export class ConversationService {
  constructor(private readonly database: DatabaseService) {}

  /** 为指定用户创建会话；标题为空时使用默认标题。 */
  async create(userId: string, title?: string) {
    const [conversation] = await this.database.db
      .insert(conversations)
      .values({ id: crypto.randomUUID(), userId, title: title?.trim() || DEFAULT_CONVERSATION_TITLE, updatedAt: new Date() })
      .returning();
    return conversation!;
  }

  /**
   * 按最近更新时间倒序返回用户拥有的会话，limit/offset 直接作用于会话行本身。
   *
   * 分页必须落在 conversations 上：会话与消息是一对多关系，先 join 消息再去重会让
   * offset 按「消息行」计数，页大小完全失真。因此先取一页会话，再单独查询这一页里
   * 仍是默认标题的会话，用其首条用户消息推导展示标题。
   */
  async findByUser(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(
      MAX_CONVERSATION_PAGE_SIZE,
      Math.max(1, Number(options.limit) || DEFAULT_CONVERSATION_PAGE_SIZE),
    );
    const offset = Math.max(0, Number(options.offset) || 0);

    const rows = await this.database.db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(limit)
      .offset(offset);
    if (rows.length === 0) return [];

    const untitledIds = rows
      .filter((row) => row.title === DEFAULT_CONVERSATION_TITLE)
      .map((row) => row.id);
    // DISTINCT ON 依赖 (conversationId, createdAt) 索引，按会话分组后只留最早一条用户消息。
    const firstMessages = untitledIds.length
      ? await this.database.db
          .selectDistinctOn([messages.conversationId], {
            conversationId: messages.conversationId,
            content: messages.content,
          })
          .from(messages)
          .where(
            and(
              inArray(messages.conversationId, untitledIds),
              eq(messages.role, MessageRole.USER),
            ),
          )
          .orderBy(messages.conversationId, asc(messages.createdAt), asc(messages.id))
      : [];
    const firstMessageById = new Map(
      firstMessages.map((row) => [row.conversationId, row.content]),
    );

    return rows.map((conversation) => {
      const firstMessage = firstMessageById.get(conversation.id);
      return {
        ...conversation,
        title:
          conversation.title === DEFAULT_CONVERSATION_TITLE && firstMessage
            ? createConversationTitle(firstMessage)
            : conversation.title,
      };
    });
  }

  /**
   * 按会话 ID 和用户 ID 联合查询。
   * 联合条件既承担查询职责，也作为后续读写操作的权限边界。
   */
  async findById(conversationId: string, userId: string) {
    const [conversation] = await this.database.db.select().from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);

    // 未找到和无权限返回相同结果，避免泄露其他用户的会话 ID。
    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  /** 校验会话归属后更新标题，确保用户不能重命名其他用户的会话。 */
  async rename(conversationId: string, userId: string, title: string) {
    await this.findById(conversationId, userId);

    const [conversation] = await this.database.db.update(conversations).set({ title: title.trim(), updatedAt: new Date() }).where(eq(conversations.id, conversationId)).returning();
    return conversation!;
  }

  /** 校验会话归属后删除会话；关联消息由数据库级联删除。 */
  async delete(conversationId: string, userId: string) {
    await this.findById(conversationId, userId);
    const [conversation] = await this.database.db.delete(conversations).where(eq(conversations.id, conversationId)).returning();
    return conversation!;
  }
}
