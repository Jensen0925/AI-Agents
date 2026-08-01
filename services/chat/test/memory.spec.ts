import { describe, expect, it, mock } from "bun:test";
import { MessageRole } from "@prisma/client";
import { RunnableMemoryService } from "../src/llm/memory/runnable-memory.service";
import type { MessageService } from "../src/message/message.service";

describe("RunnableMemoryService", () => {
  it("persists, reads and clears histories through MessageService", async () => {
    const histories = new Map<
      string,
      Array<{ role: MessageRole; content: string }>
    >();
    const addMessage = mock(
      async (conversationId: string, role: MessageRole, content: string) => {
        const history = histories.get(conversationId) ?? [];
        history.push({ role, content });
        histories.set(conversationId, history);
        return {};
      },
    );
    const getHistory = mock(async (conversationId: string) =>
      (histories.get(conversationId) ?? []).map((message) => ({
        ...message,
      })),
    );
    const clearHistory = mock(async (conversationId: string) => {
      histories.delete(conversationId);
    });
    const messageService = {
      addMessage,
      getHistory,
      clearHistory,
    } as unknown as MessageService;
    const service = new RunnableMemoryService(messageService);

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
    expect(addMessage).toHaveBeenCalledTimes(4);
    expect(clearHistory).toHaveBeenCalledWith("s1");
  });
});
