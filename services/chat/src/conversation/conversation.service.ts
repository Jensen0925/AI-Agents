import { Injectable, NotFoundException } from "@nestjs/common";
import { MessageRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  createConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "./conversation-title";

/** 管理用户会话，并在所有单条记录操作中强制校验会话归属。 */
@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 为指定用户创建会话；标题为空时使用默认标题。 */
  create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: {
        userId,
        title: title?.trim() || DEFAULT_CONVERSATION_TITLE,
      },
    });
  }

  /**
   * 按最近更新时间倒序返回用户拥有的全部会话。
   *
   * 旧会话可能已经保存为“新会话”，这里使用首条用户消息即时补足展示标题；
   * 新消息则会在 MessageService 写入时持久化标题，因此不会影响已有会话排序。
   */
  async findByUser(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          where: { role: MessageRole.USER },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { content: true },
        },
      },
    });

    return conversations.map(({ messages, ...conversation }) => ({
      ...conversation,
      title:
        conversation.title === DEFAULT_CONVERSATION_TITLE && messages[0]
          ? createConversationTitle(messages[0].content)
          : conversation.title,
    }));
  }

  /**
   * 按会话 ID 和用户 ID 联合查询。
   * 联合条件既承担查询职责，也作为后续读写操作的权限边界。
   */
  async findById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    // 未找到和无权限返回相同结果，避免泄露其他用户的会话 ID。
    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  /** 校验会话归属后更新标题，确保用户不能重命名其他用户的会话。 */
  async rename(conversationId: string, userId: string, title: string) {
    await this.findById(conversationId, userId);

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: title.trim(),
        updatedAt: new Date(),
      },
    });
  }

  /** 校验会话归属后删除会话；关联消息由数据库级联删除。 */
  async delete(conversationId: string, userId: string) {
    await this.findById(conversationId, userId);
    return this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }
}
