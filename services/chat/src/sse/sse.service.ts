import { and, asc, count, desc, eq, isNull, lt } from "drizzle-orm";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Cron, Interval } from "@nestjs/schedule";
import type { Response } from "express";
import { DatabaseService } from "../database/database.service";
import {
  taskEvents,
  type JsonValue,
  type TaskEvent,
  type TaskStatus,
} from "../database/schema";

const TASK_EVENT_RETENTION_DAYS = 30;

export interface EmitTaskEvent {
  taskType: string;
  taskId: string;
  status: TaskStatus;
  message?: string;
  metadata?: JsonValue;
}

export interface PaginatedTaskEvents {
  items: TaskEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * 管理用户 SSE 长连接与任务事件持久化。
 * 一个 userId 可以绑定多个 Response，从而同时向同一用户的多个 Tab 推送。
 */
@Injectable()
export class SseService {
  private readonly connections = new Map<string, Set<Response>>();

  constructor(private readonly database: DatabaseService) {}

  /** 注册用户连接；Set 可避免同一个 Response 被重复加入。 */
  addConnection(userId: string, response: Response): void {
    const userConnections = this.connections.get(userId) ?? new Set<Response>();
    userConnections.add(response);
    this.connections.set(userId, userConnections);
  }

  /** 移除指定连接，并在用户没有其他 Tab 在线时删除空 Map entry。 */
  removeConnection(userId: string, response: Response): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return;
    }

    userConnections.delete(response);
    if (userConnections.size === 0) {
      this.connections.delete(userId);
    }
  }

  /**
   * 先将任务事件写入数据库，再广播到该用户的所有在线连接。
   * 数据库写入失败时不会发送瞬时事件，保证历史记录与实时消息顺序一致。
   */
  async emit(userId: string, event: EmitTaskEvent): Promise<TaskEvent> {
    const [persistedEvent] = await this.database.db
      .insert(taskEvents)
      .values({
        id: crypto.randomUUID(),
        userId,
        taskType: event.taskType,
        taskId: event.taskId,
        status: event.status,
        message: event.message,
        metadata: event.metadata,
      })
      .returning();
    const payload = [
      `id: ${persistedEvent.id}`,
      "event: task",
      `data: ${JSON.stringify(persistedEvent)}`,
      "",
      "",
    ].join("\n");

    for (const response of this.connections.get(userId) ?? []) {
      if (response.destroyed || response.writableEnded) {
        this.removeConnection(userId, response);
        continue;
      }

      try {
        response.write(payload);
      } catch {
        this.removeConnection(userId, response);
      }
    }

    return persistedEvent;
  }

  /** 分页读取当前用户的任务事件，最新事件优先。 */
  async getHistory(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedTaskEvents> {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.database.db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.userId, userId))
        .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id))
        .limit(pageSize)
        .offset(skip),
      this.database.db
        .select({ count: count() })
        .from(taskEvents)
        .where(eq(taskEvents.userId, userId)),
    ]);

    return {
      items,
      page,
      pageSize,
      total: total[0]?.count ?? 0,
      totalPages: Math.ceil((total[0]?.count ?? 0) / pageSize),
    };
  }

  /** 返回当前用户指定 taskId 的完整状态时间线。 */
  async findByTaskId(userId: string, taskId: string): Promise<TaskEvent[]> {
    const events = await this.database.db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.userId, userId), eq(taskEvents.taskId, taskId)))
      .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));
    if (events.length === 0) {
      throw new NotFoundException("Task not found");
    }

    return events;
  }

  /** 将当前用户指定任务的全部未读事件标记为已读，并返回更新时间。 */
  async markTaskRead(
    userId: string,
    taskId: string,
  ): Promise<{ taskId: string; updated: number; readAt: Date }> {
    await this.findByTaskId(userId, taskId);
    const readAt = new Date();
    const updated = await this.database.db
      .update(taskEvents)
      .set({ readAt })
      .where(
        and(
          eq(taskEvents.userId, userId),
          eq(taskEvents.taskId, taskId),
          isNull(taskEvents.readAt),
        ),
      )
      .returning({ id: taskEvents.id });

    return { taskId, updated: updated.length, readAt };
  }

  /** 每分钟移除已经关闭但未触发 close 回调的连接。 */
  @Interval(60_000)
  cleanupOfflineConnections(): void {
    for (const [userId, responses] of this.connections) {
      for (const response of responses) {
        if (response.destroyed || response.writableEnded) {
          responses.delete(response);
        }
      }
      if (responses.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /** 每天凌晨 3 点删除 30 天以前的任务事件。 */
  @Cron("0 0 3 * * *")
  async cleanupExpiredTaskEvents(): Promise<number> {
    const cutoff = new Date(
      Date.now() - TASK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const deleted = await this.database.db
      .delete(taskEvents)
      .where(lt(taskEvents.createdAt, cutoff))
      .returning({ id: taskEvents.id });
    return deleted.length;
  }
}
