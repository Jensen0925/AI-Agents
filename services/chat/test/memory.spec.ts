import { describe, expect, it } from "bun:test";
import { RunnableMemoryService } from "../src/llm/memory/runnable-memory.service";

describe("RunnableMemoryService", () => {
  it("isolates, reads and clears histories by sessionId", async () => {
    const service = new RunnableMemoryService();

    await service.appendMessage("s1", "需求单号是什么？", "REQ-2026-001");
    await service.appendMessage("s2", "另一个会话", "独立的回复");

    expect(await service.getHistory("s1")).toEqual([
      { role: "human", content: "需求单号是什么？" },
      { role: "ai", content: "REQ-2026-001" },
    ]);
    expect(await service.getHistory("s2")).toEqual([
      { role: "human", content: "另一个会话" },
      { role: "ai", content: "独立的回复" },
    ]);

    await service.clearSession("s1");

    expect(await service.getHistory("s1")).toEqual([]);
    expect(await service.getHistory("s2")).toHaveLength(2);
  });
});
