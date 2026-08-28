import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { ArtifactType } from "../src/database/schema";
import { ArtifactService } from "../src/artifact/artifact.service";
import { createDatabaseMock } from "./drizzle-test-utils";

function artifactRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    conversationId: "conversation-1",
    userId: "user-1",
    title: "登录需求分析",
    type: ArtifactType.MARKDOWN,
    language: null,
    content: "初版报告",
    currentVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("artifact service", () => {
  it("creates a versioned artifact for the first generated report", async () => {
    const artifact = artifactRecord();
    const database = createDatabaseMock({
      select: [[{ id: "conversation-1" }], []],
      returning: [[artifact], [{ ...artifact, currentVersion: 1 }]],
    });
    const service = new ArtifactService(database);

    const result = await service.upsertGeneratedReport({
      conversationId: "conversation-1",
      userId: "user-1",
      title: "登录需求分析",
      content: "## 需求摘要",
    });

    expect(result.id).toBe("artifact-1");
    expect((database.db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((database.db.update as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("creates a new immutable version when a report is regenerated", async () => {
    const existing = artifactRecord({ currentVersion: 3 });
    const updated = artifactRecord({ currentVersion: 4, content: "新的分析结论" });
    const database = createDatabaseMock({
      select: [[{ id: "conversation-1" }], [existing]],
      returning: [[updated]],
    });
    const service = new ArtifactService(database);

    const result = await service.upsertGeneratedReport({
      conversationId: "conversation-1",
      userId: "user-1",
      title: "新版报告",
      content: "新的分析结论",
    });

    expect(result.currentVersion).toBe(4);
    expect((database.db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("does not expose an artifact that belongs to another user", async () => {
    const database = createDatabaseMock({ select: [[]] });
    const service = new ArtifactService(database);

    await expect(service.findById("artifact-1", "other-user")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns no artifact when the optional artifact tables have not been migrated", async () => {
    const missingTable = new Error("relation artifacts does not exist");
    const database = createDatabaseMock({ select: [[{ id: "conversation-1" }]] });
    let selectCount = 0;
    (database.db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCount += 1;
      if (selectCount === 2) throw missingTable;
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => [{ id: "conversation-1" }]),
      };
    });
    const service = new ArtifactService(database);

    await expect(service.findByConversation("conversation-1", "user-1")).resolves.toBeNull();
  });

  it("does not hide unrelated database failures when loading artifacts", async () => {
    const database = createDatabaseMock({ select: [[{ id: "conversation-1" }]] });
    let selectCount = 0;
    (database.db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCount += 1;
      if (selectCount === 2) throw new Error("database connection lost");
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => [{ id: "conversation-1" }]),
      };
    });
    const service = new ArtifactService(database);

    await expect(service.findByConversation("conversation-1", "user-1")).rejects.toThrow(
      "database connection lost",
    );
  });
});
