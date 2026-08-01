import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** 管理用户会话，并在所有单条记录操作中强制校验会话归属。 */
@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 为指定用户创建会话；标题为空时使用默认标题。 */
  create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: {
        userId,
        title: title?.trim() || "新会话",
      },
    });
  }

  /** 按最近更新时间倒序返回用户拥有的全部会话。 */
  findByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
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

  /** 校验会话归属后删除会话；关联消息由数据库级联删除。 */
  async delete(conversationId: string, userId: string) {
    await this.findById(conversationId, userId);
    return this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }
}
