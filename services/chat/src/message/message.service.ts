import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import {
  MessageRole,
  type Prisma,
} from "@prisma/client";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** 负责会话消息持久化，并在数据库消息与 LangChain 消息之间转换。 */
@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在事务中新增消息并刷新会话 updatedAt，保证会话排序与消息写入一致。
   */
  addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.message.create({
        data: {
          conversationId,
          role,
          content,
          metadata,
        },
      });

      await transaction.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return message;
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
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });

    return messages.reverse();
  }

  /** 将数据库 USER/ASSISTANT 角色转换为 LangChain HumanMessage/AIMessage。 */
  async getHistoryAsLangChainMessages(
    conversationId: string,
  ): Promise<BaseMessage[]> {
    const messages = await this.getHistory(conversationId);
    return messages.map((message) =>
      message.role === MessageRole.USER
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    );
  }

  /** 清空指定会话的全部消息，保留会话本身。 */
  async clearHistory(conversationId: string): Promise<void> {
    await this.prisma.message.deleteMany({
      where: { conversationId },
    });
  }
}
