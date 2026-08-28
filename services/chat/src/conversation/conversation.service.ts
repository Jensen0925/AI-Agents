import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { conversations, messages } from "../database/schema";
import {
  createConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "./conversation-title";

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
   * 按最近更新时间倒序返回用户拥有的全部会话。
   *
   * 旧会话可能已经保存为“新会话”，这里使用首条用户消息即时补足展示标题；
   * 新消息则会在 MessageService 写入时持久化标题，因此不会影响已有会话排序。
   */
  async findByUser(userId: string) {
    const rows = await this.database.db
      .select({ conversation: conversations, firstMessage: messages.content })
      .from(conversations)
      .innerJoin(messages, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.userId, userId), eq(messages.role, "USER")))
      .orderBy(desc(conversations.updatedAt), asc(messages.createdAt), asc(messages.id));
    const found = new Set<string>();
    return rows.flatMap(({ conversation, firstMessage }) => {
      if (found.has(conversation.id)) return [];
      found.add(conversation.id);
      return [{ ...conversation, title: conversation.title === DEFAULT_CONVERSATION_TITLE ? createConversationTitle(firstMessage) : conversation.title }];
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
