import { describe, expect, it, mock } from "bun:test";
import { TaskStatus, type TaskEvent } from "@prisma/client";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import type { PrismaService } from "../src/prisma/prisma.service";
import { SseController } from "../src/sse/sse.controller";
import { SseService } from "../src/sse/sse.service";
import { TaskEventController } from "../src/sse/task-event.controller";

function taskEvent(id: string): TaskEvent {
  return {
    id,
    userId: "user-1",
    taskType: "document_processing",
    taskId: "document-1",
    status: TaskStatus.processing,
    message: "started",
    metadata: null,
    createdAt: new Date(),
    readAt: null,
  };
}

function response(write: ReturnType<typeof mock>): Response {
  return {
    destroyed: false,
    writableEnded: false,
    write,
  } as unknown as Response;
}

describe("SseService", () => {
  it("persists before broadcasting to every tab of the same user", async () => {
    const order: string[] = [];
    const create = mock(async () => {
      order.push("persist");
      return taskEvent("event-1");
    });
    const firstWrite = mock((_chunk: unknown) => {
      order.push("first-tab");
      return true;
    });
    const secondWrite = mock((_chunk: unknown) => {
      order.push("second-tab");
      return true;
    });
    const prisma = { taskEvent: { create } } as unknown as PrismaService;
    const service = new SseService(prisma);
    const first = response(firstWrite);
    const second = response(secondWrite);
    service.addConnection("user-1", first);
    service.addConnection("user-1", second);

    await service.emit("user-1", {
      taskType: "document_processing",
      taskId: "document-1",
      status: TaskStatus.processing,
    });

    expect(order).toEqual(["persist", "first-tab", "second-tab"]);
    expect(String(firstWrite.mock.calls[0]?.[0])).toContain("event: task");
    expect(String(firstWrite.mock.calls[0]?.[0])).toContain("event-1");

    service.removeConnection("user-1", first);
    await service.emit("user-1", {
      taskType: "document_processing",
      taskId: "document-1",
      status: TaskStatus.done,
    });
    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).toHaveBeenCalledTimes(2);
  });

  it("paginates history within the current user", async () => {
    const findMany = mock(async () => [taskEvent("event-1")]);
    const count = mock(async () => 21);
    const prisma = {
      taskEvent: { findMany, count },
    } as unknown as PrismaService;
    const service = new SseService(prisma);

    const result = await service.getHistory("user-1", 2, 10);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
    expect(result.totalPages).toBe(3);
  });
});

describe("SSE controllers", () => {
  it("mounts JWT-protected SSE and task history routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SseController)).toBe("api/sse");
    expect(Reflect.getMetadata(PATH_METADATA, TaskEventController)).toBe(
      "api/tasks",
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SseController) as unknown[],
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TaskEventController) as unknown[],
    ).toContain(JwtAuthGuard);
  });
});
