import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { TaskStatus } from "../src/database/schema";
import { SseController } from "../src/sse/sse.controller";
import { SseService } from "../src/sse/sse.service";
import { TaskEventController } from "../src/sse/task-event.controller";
import { createDatabaseMock } from "./drizzle-test-utils";

function response(write: ReturnType<typeof vi.fn>): Response {
  return { destroyed: false, writableEnded: false, write } as unknown as Response;
}

describe("SseService", () => {
  it("persists before broadcasting to every tab of the same user", async () => {
    const persisted = {
      id: "event-1",
      userId: "user-1",
      taskType: "document_processing",
      taskId: "document-1",
      status: TaskStatus.processing,
      message: "started",
      metadata: null,
      createdAt: new Date(),
      readAt: null,
    };
    const order: string[] = [];
    const firstWrite = vi.fn(() => {
      order.push("first-tab");
      return true;
    });
    const secondWrite = vi.fn(() => {
      order.push("second-tab");
      return true;
    });
    const database = createDatabaseMock({ returning: [[persisted]] });
    (database.db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push("persist");
      return {
        values: () => ({ returning: async () => [persisted] }),
      };
    });
    const service = new SseService(database);
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
    expect(firstWrite).toHaveBeenCalled();
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
    const database = createDatabaseMock({
      select: [[{ id: "event-1" }], [{ count: 21 }]],
    });
    const service = new SseService(database);

    const result = await service.getHistory("user-1", 2, 10);

    expect(result.items).toHaveLength(1);
    expect(result.totalPages).toBe(3);
  });
});

describe("SSE controllers", () => {
  it("mounts JWT-protected SSE and task history routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SseController)).toBe("api/sse");
    expect(Reflect.getMetadata(PATH_METADATA, TaskEventController)).toBe("api/tasks");
    expect(Reflect.getMetadata(GUARDS_METADATA, SseController) as unknown[]).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, TaskEventController) as unknown[]).toContain(JwtAuthGuard);
  });
});
