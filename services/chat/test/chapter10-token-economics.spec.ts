import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, mock } from "bun:test";
import { compressConversation } from "../src/llm/context/conversation-compressor";
import { trimMessagesForContext } from "../src/llm/context/message-trimmer";
import {
  AGENT_REASONING_EFFORT,
  DEFAULT_AGENT_MODEL_SET,
  HIGH_RISK_AGENTS,
  resolveModelForAgent,
} from "../src/llm/cost/agent-model-set";
import {
  estimateGraphNodeCost,
  estimateTextTokens,
  getModelPricing,
} from "../src/llm/cost/token-estimator";
import { TokenUsageService } from "../src/llm/cost/token-usage.service";
import { withTokenUsage } from "../src/llm/cost/with-token-usage";
import { resolveBudgetAction } from "../src/llm/cost/budget-policy";

describe("chapter 10 token economics estimator", () => {
  it("returns zero for empty text", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens(null)).toBe(0);
    expect(estimateTextTokens(undefined)).toBe(0);
  });

  it("counts Chinese text and punctuation as tokens", () => {
    expect(estimateTextTokens("需求分析助手，负责需求拆解。\n")).toBeGreaterThan(0);
  });

  it("estimates English text at roughly one token per four characters", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcdefgh")).toBe(2);
    expect(estimateTextTokens("abcde")).toBe(2);
  });

  it("falls back to gpt-5.6-terra for unknown models", () => {
    expect(getModelPricing("unknown-model")).toEqual(getModelPricing("gpt-5.6-terra"));
  });

  it("charges tool schemas as part of input context", () => {
    const base = estimateGraphNodeCost({
      nodeName: "analysis",
      modelName: "gpt-5.6-terra",
      systemPrompt: "分析需求",
      messages: ["开发登录功能"],
      outputText: "分析结果",
    });
    const withTools = estimateGraphNodeCost({
      nodeName: "analysis",
      modelName: "gpt-5.6-terra",
      systemPrompt: "分析需求",
      toolSchemas: { name: "search_requirement", schema: { reqId: "string" } },
      messages: ["开发登录功能"],
      outputText: "分析结果",
    });
    expect(withTools.inputTokens).toBeGreaterThan(base.inputTokens);
    expect(withTools.estimatedCostUsd).toBeGreaterThan(base.estimatedCostUsd);
  });

  it("uses output pricing for generated output tokens", () => {
    const estimate = estimateGraphNodeCost({
      nodeName: "summary",
      modelName: "gpt-5.6-terra",
      systemPrompt: "",
      outputText: "abcdefgh",
    });
    const expected = (2 * getModelPricing("gpt-5.6-terra").output) / 1_000_000;
    expect(estimate.outputTokens).toBe(2);
    expect(estimate.estimatedCostUsd).toBe(expected);
  });
});

describe("10.5.1 message-trimmer", () => {
  it("preserves system messages and keeps only the latest N non-system messages", () => {
    const system = new SystemMessage("需求分析助手");
    const messages = [system, new HumanMessage("第一轮"), new AIMessage("第一轮回复"), new HumanMessage("第二轮"), new AIMessage("第二轮回复")];
    expect(trimMessagesForContext(messages, { maxMessages: 2 })).toEqual([system, messages[3], messages[4]]);
  });

  it("removes orphan ToolMessage", () => {
    const orphan = new ToolMessage({ content: "孤立", tool_call_id: "tool-1" });
    expect(trimMessagesForContext([new HumanMessage("需求"), orphan])).toHaveLength(1);
  });

  it("keeps AIMessage and ToolMessage with an exact matching id", () => {
    const call = new AIMessage({ content: "", tool_calls: [{ id: "tool-1", name: "query", args: {}, type: "tool_call" }] });
    const response = new ToolMessage({ content: "结果", tool_call_id: "tool-1" });
    expect(trimMessagesForContext([new HumanMessage("查询"), call, response])).toEqual([expect.any(HumanMessage), call, response]);
  });

  it("removes mismatched orphan tool results", () => {
    const call = new AIMessage({ content: "", tool_calls: [{ id: "tool-correct", name: "query", args: {}, type: "tool_call" }] });
    const correct = new ToolMessage({ content: "正确", tool_call_id: "tool-correct" });
    const mismatched = new ToolMessage({ content: "错误", tool_call_id: "tool-other" });
    expect(trimMessagesForContext([call, correct, mismatched])).toEqual([call, correct]);
  });

  it("removes a whole AI tool call when one response is missing", () => {
    const call = new AIMessage({ content: "", tool_calls: [{ id: "tool-1", name: "first", args: {}, type: "tool_call" }, { id: "tool-2", name: "second", args: {}, type: "tool_call" }] });
    const response = new ToolMessage({ content: "只有一个", tool_call_id: "tool-1" });
    expect(trimMessagesForContext([new HumanMessage("执行"), call, response])).toEqual([expect.any(HumanMessage)]);
  });
});

describe("10.5.2 conversation-compressor", () => {
  it("does not invoke the summary model for a short conversation", async () => {
    const invoke = mock(async () => ({ content: "不应调用" }));
    const messages = [new SystemMessage("系统"), new HumanMessage("你好")];
    expect(await compressConversation(messages, { invoke }, { keepRecent: 2 })).toBe(messages);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("compresses early history and preserves system messages", async () => {
    const invoke = mock(async () => ({ content: "REQ-2026-001：已完成需求类型选择。" }));
    const system = new SystemMessage("你是需求分析助手");
    const messages = [system, new HumanMessage("需求编号 REQ-2026-001"), new AIMessage("已记录编号"), new HumanMessage("批量导入 Excel"), new AIMessage("请补充规则"), new HumanMessage("规则已确认")];
    const result = await compressConversation(messages, { invoke }, { keepRecent: 2, summaryMaxTokens: 500 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result[0]).toBe(system);
    expect(result[1]?.content).toContain("[对话摘要]");
    expect(result.slice(-2)).toEqual(messages.slice(-2));
  });
});

describe("10.9.1 AgentModelSet", () => {
  it("uses Terra for every role and differentiates medium/high reasoning", () => {
    for (const modelConfigId of Object.values(DEFAULT_AGENT_MODEL_SET)) {
      expect(modelConfigId).toBe("demo-gpt-5.6-terra");
    }
    expect(AGENT_REASONING_EFFORT.functional_expert).toBe("medium");
    expect(AGENT_REASONING_EFFORT.supervisor).toBe("high");
  });

  it("assigns all five high-risk roles to demo-gpt-5.6-terra by default", () => {
    expect(HIGH_RISK_AGENTS).toHaveLength(5);
    for (const agentName of HIGH_RISK_AGENTS) {
      expect(resolveModelForAgent({ agentName }).selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    }
  });

  it("reduces reasoning to medium for low complexity without changing Terra", () => {
    const result = resolveModelForAgent({ agentName: "functional_expert", requirementComplexity: "low" });
    expect(result.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(result.reasoningEffort).toBe("medium");
    expect(result.overrideReason).toContain("low_complexity");
  });
});

describe("10.9.2 runtime model overrides", () => {
  it("keeps the default model below the budget warning threshold", () => {
    const result = resolveModelForAgent({ agentName: "functional_expert", budgetStatus: { usedPercent: 79 } });
    expect(result.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(result.reasoningEffort).toBe("medium");
    expect(result.overrideReason).toBeNull();
  });

  it("downgrades functional at 85% budget but protects security at 90%", () => {
    const functional = resolveModelForAgent({ agentName: "functional_expert", budgetStatus: { usedPercent: 85 } });
    const security = resolveModelForAgent({ agentName: "security_expert", budgetStatus: { usedPercent: 90 } });
    expect(functional.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(functional.reasoningEffort).toBe("medium");
    expect(functional.overrideReason).toContain("budget_tight_downgrade");
    expect(security.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(security.reasoningEffort).toBe("high");
    expect(security.overrideReason).toBeNull();
  });

  it("rejects non-compressor agents after budget exhaustion", () => {
    const result = resolveModelForAgent({ agentName: "risk_agent", budgetStatus: { usedPercent: 110 } });
    expect(result.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(result.overrideReason).toBe("budget_exceeded_reject");
  });

  it("exempts compressor after budget exhaustion", () => {
    const result = resolveModelForAgent({ agentName: "compressor", budgetStatus: { usedPercent: 110 } });
    expect(result.selectedModelConfigId).toBe("demo-gpt-5.6-terra");
    expect(result.reasoningEffort).toBe("medium");
    expect(result.overrideReason).toBeNull();
  });

  it("returns a non-empty reason for every actual override", () => {
    const lowComplexity = resolveModelForAgent({ agentName: "risk_agent", requirementComplexity: "low" });
    const budgetTight = resolveModelForAgent({ agentName: "performance_expert", budgetStatus: { usedPercent: 80 } });
    const rejected = resolveModelForAgent({ agentName: "supervisor", budgetStatus: { usedPercent: 100 } });
    expect(lowComplexity.overrideReason).toBeTruthy();
    expect(budgetTight.overrideReason).toBeTruthy();
    expect(rejected.overrideReason).toBeTruthy();
  });
});

describe("10.8.2 TokenUsageService", () => {
  function createPrismaMock() {
    return {
      tokenUsage: {
        create: mock(async (_args: unknown) => ({ id: "usage-1" })),
        aggregate: mock(async (_args: unknown) => ({
          _sum: {
            estimatedCostUsd: 1.25,
            inputTokens: 1_000,
            outputTokens: 200,
            cachedInputTokens: 100,
          },
          _count: { _all: 4 },
        })),
        groupBy: mock(async (_args: unknown) => []),
      },
    };
  }

  it("writes a complete usage row and derives totalTokens", async () => {
    const prisma = createPrismaMock();
    const service = new TokenUsageService(prisma as never);
    await service.recordUsage({
      conversationId: "conversation-1",
      messageId: "message-1",
      threadId: "thread-1",
      graphName: "requirement-analysis",
      nodeName: "functional",
      agentName: "functional_expert",
      modelConfigId: "demo-gpt-5.6-terra",
      modelName: "gpt-5.6-terra",
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
      estimatedCostUsd: 0.00002,
      latencyMs: 88,
      overrideReason: "low_complexity_downgrade",
    });
    expect(prisma.tokenUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "openai",
        totalTokens: 120,
        isEstimated: false,
        inputTokens: 100,
        outputTokens: 20,
      }),
    });
  });

  it("aggregates current-month totals", async () => {
    const prisma = createPrismaMock();
    const service = new TokenUsageService(prisma as never);
    expect(await service.getMonthlyStats()).toEqual({
      totalCost: 1.25,
      totalInputTokens: 1_000,
      totalOutputTokens: 200,
      totalCachedTokens: 100,
      calls: 4,
    });
    const call = prisma.tokenUsage.aggregate.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(call.where.createdAt.gte.getDate()).toBe(1);
  });

  it("groups node and agent costs in descending order", async () => {
    const prisma = createPrismaMock();
    prisma.tokenUsage.groupBy
      .mockResolvedValueOnce([
        { nodeName: "summary", _sum: { estimatedCostUsd: 2 }, _count: { _all: 3 } },
        { nodeName: "risk", _sum: { estimatedCostUsd: 1 }, _count: { _all: 2 } },
      ] as never)
      .mockResolvedValueOnce([
        { agentName: "summary_agent", _sum: { estimatedCostUsd: 2 }, _count: { _all: 3 } },
        { agentName: "risk_agent", _sum: { estimatedCostUsd: 1 }, _count: { _all: 2 } },
      ] as never);
    const service = new TokenUsageService(prisma as never);
    expect(await service.getStatsByNode()).toEqual([
      { nodeName: "summary", totalCost: 2, calls: 3 },
      { nodeName: "risk", totalCost: 1, calls: 2 },
    ]);
    expect(await service.getStatsByAgent()).toEqual([
      { agentName: "summary_agent", totalCost: 2, calls: 3 },
      { agentName: "risk_agent", totalCost: 1, calls: 2 },
    ]);
    expect(prisma.tokenUsage.groupBy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ orderBy: { _sum: { estimatedCostUsd: "desc" } } }),
    );
  });

  it("reports whether the monthly budget is exhausted", async () => {
    const prisma = createPrismaMock();
    const service = new TokenUsageService(prisma as never);
    expect(await service.isOverBudget(1)).toBe(true);
    expect(await service.isOverBudget(2)).toBe(false);
  });

  it("swallows prisma write errors", async () => {
    const prisma = createPrismaMock();
    prisma.tokenUsage.create.mockRejectedValueOnce(new Error("database unavailable"));
    const service = new TokenUsageService(prisma as never);
    await expect(
      service.recordUsage({
        graphName: "graph",
        nodeName: "node",
        agentName: "agent",
        modelName: "gpt-5.6-terra",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("10.8.3 withTokenUsage", () => {
  it("records exact OpenAI usage including cached tokens", async () => {
    const recordUsage = mock(async () => undefined);
    const response = {
      content: "完成",
      response_metadata: {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      },
    };
    expect(
      await withTokenUsage(
        { graphName: "graph", nodeName: "summary", agentName: "summary_agent", modelName: "gpt-5.6-terra" },
        { recordUsage } as never,
        async () => response,
      ),
    ).toBe(response);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 40,
        isEstimated: false,
      }),
    );
  });

  it("estimates usage at a 5:1 input/output ratio when metadata is absent", async () => {
    const recordUsage = mock(async () => undefined);
    const response = { content: "abcdefgh" };
    await withTokenUsage(
      { graphName: "graph", nodeName: "node", agentName: "agent", modelName: "gpt-5.6-terra" },
      { recordUsage } as never,
      async () => response,
    );
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        outputTokens: 2,
        inputTokens: 10,
        totalTokens: 12,
        cachedInputTokens: 0,
        isEstimated: true,
      }),
    );
  });

  it("returns the model response when recording throws", async () => {
    const response = { content: "仍然返回" };
    const recordUsage = mock(async () => {
      throw new Error("write failed");
    });
    expect(
      await withTokenUsage(
        { graphName: "graph", nodeName: "node", agentName: "agent", modelName: "gpt-5.6-terra" },
        { recordUsage } as never,
        async () => response,
      ),
    ).toBe(response);
  });

  it("skips recording when usageService is null", async () => {
    const response = { content: "无采集服务" };
    expect(
      await withTokenUsage(
        { graphName: "graph", nodeName: "node", agentName: "agent", modelName: "gpt-5.6-terra" },
        null,
        async () => response,
      ),
    ).toBe(response);
  });
});

describe("10.9.3 预算动作选择 - resolveBudgetAction", () => {
  it("allows normal execution below 80% budget", () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 50,
      agentName: "functional_expert",
    });
    expect(result).toEqual({ action: "allow", reason: "budget OK (50%)" });
  });

  it("downgrades a low-risk functional expert at 85% budget", () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 85,
      agentName: "functional_expert",
    });
    expect(result.action).toBe("downgrade");
    expect(result.reason).toContain("85");
  });

  it("does not downgrade a high-risk security expert at 90% budget", () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 90,
      agentName: "security_expert",
    });
    expect(result.action).toBe("allow");
    expect(result.reason).toContain("high-risk");
    expect(result.reason).toContain("90");
  });

  it("rejects a regular agent after the budget is exhausted", () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: "risk_agent",
    });
    expect(result.action).toBe("reject");
    expect(result.reason).toContain("110");
  });

  it("always allows the compressor after the budget is exhausted", () => {
    const result = resolveBudgetAction({
      budgetUsedPercent: 110,
      agentName: "compressor",
    });
    expect(result.action).toBe("allow");
    expect(result.reason).toContain("compressor allowed even over budget");
  });
});
