import { AIMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const RETRIEVED_CONTEXT = "当前用户知识库没有检索到相关文档。";
const EXTRACTED = JSON.stringify({
  title: "会话记忆系统",
  actors: ["需求分析师"],
  goals: ["支持多轮澄清"],
});
const CLARIFIED = JSON.stringify({
  needsClarification: false,
  questions: [],
});
type AgentInput = Record<string, unknown>;
type MessageLike = { content: unknown };

const invocationOrder: string[] = [];
let classifierShouldFail = false;

function messageInput(messages: MessageLike[]): string {
  const content = messages.at(-1)?.content;
  return typeof content === "string" ? content : "";
}

function mockIntent(input: string): "analyze" | "query" | "chat" {
  if (/^(你好|您好|嗨)|天气不错/i.test(input)) {
    return "chat";
  }

  if (
    /分析需求/i.test(input) &&
    /(?:开发|实现|新增|建设|创建).*(?:系统|功能|能力|模块)/i.test(input)
  ) {
    return "analyze";
  }

  if (/\bREQ-\d{8}-\d{3,}\b/i.test(input)) {
    return "query";
  }

  return "analyze";
}

const fakeModel = {
  withStructuredOutput: () => ({
    invoke: async (messages: MessageLike[]) => {
      invocationOrder.push("classifier");
      if (classifierShouldFail) {
        throw new Error("classifier unavailable");
      }

      const input = messageInput(messages);
      return { intent: mockIntent(input), reasoning: "mock classifier" };
    },
  }),
  invoke: async (messages: MessageLike[]) => {
    const system = messages[0]?.content;
    const input = messageInput(messages);

    if (system === "你是需求查询助手") {
      invocationOrder.push("queryHandler");
      return new AIMessage(`需求查询结果：${input}`);
    }

    invocationOrder.push("chatHandler");
    return new AIMessage(`聊天回复：${input}`);
  },
};

mock.module("../src/llm/model.factory", () => ({
  createChatModel: () => fakeModel,
}));

const extractInvoke = mock(async (_input: AgentInput) => {
  invocationOrder.push("extract");
  return EXTRACTED;
});
const clarifyInvoke = mock(async (_input: AgentInput) => {
  invocationOrder.push("clarify");
  return CLARIFIED;
});
const analysisInvoke = mock(async (_input: AgentInput) => {
  invocationOrder.push("analysis");
  return "需求分析结果";
});
const riskInvoke = mock(async (_input: AgentInput) => {
  invocationOrder.push("risk");
  return "风险评估结果";
});
const summaryInvoke = mock(async (_input: AgentInput) => {
  invocationOrder.push("summary");
  return "最终需求分析报告";
});

mock.module("../src/llm/agents/sub-agents", () => ({
  extractAgent: { invoke: extractInvoke },
  clarifyAgent: { invoke: clarifyInvoke },
  analysisAgent: { invoke: analysisInvoke },
  riskAgent: { invoke: riskInvoke },
  summaryAgent: { invoke: summaryInvoke },
}));

const { classifyIntentByKeywords, runAnalysisGraph } = require(
  "../src/llm/graph/requirement-analysis-graph"
) as typeof import("../src/llm/graph/requirement-analysis-graph");
const { runRequirementAnalysis } = require(
  "../src/llm/agents/requirement-analysis"
) as typeof import("../src/llm/agents/requirement-analysis");

/** LangGraph 迁移前五个 Agent 的顺序 Promise 调用，用作 summary 回归基准。 */
async function runLegacyPromiseChain(input: string): Promise<string> {
  const extracted = await extractInvoke({
    input,
    retrievedContext: RETRIEVED_CONTEXT,
  });
  await clarifyInvoke({
    input,
    extracted,
    retrievedContext: RETRIEVED_CONTEXT,
  });
  const analysis = await analysisInvoke({
    input,
    extracted,
    retrievedContext: RETRIEVED_CONTEXT,
  });
  const risk = await riskInvoke({
    input,
    extracted,
    retrievedContext: RETRIEVED_CONTEXT,
  });

  return summaryInvoke({
    input,
    extracted,
    analysis,
    risks: risk,
    retrievedContext: RETRIEVED_CONTEXT,
  });
}

describe("requirement analysis graph", () => {
  beforeEach(() => {
    invocationOrder.length = 0;
    classifierShouldFail = false;
    extractInvoke.mockClear();
    clarifyInvoke.mockClear();
    analysisInvoke.mockClear();
    riskInvoke.mockClear();
    summaryInvoke.mockClear();
  });

  it("keeps the legacy summary on the complete analysis branch", async () => {
    const input = "我需要一个用户登录功能";
    const legacySummary = await runLegacyPromiseChain(input);
    invocationOrder.length = 0;

    const result = await runAnalysisGraph(input);

    expect(result.intent).toBe("analyze");
    expect(invocationOrder.slice(0, 3)).toEqual([
      "classifier",
      "extract",
      "clarify",
    ]);
    expect(new Set(invocationOrder.slice(3, 5))).toEqual(
      new Set(["analysis", "risk"]),
    );
    expect(invocationOrder.at(-1)).toBe("summary");
    expect(result.extracted).toBe(EXTRACTED);
    expect(result.clarified).toBe(CLARIFIED);
    expect(result.analysisResult).toBe("需求分析结果");
    expect(result.riskResult).toBe("风险评估结果");
    expect(result.summary).toBe(legacySummary);
    expect(result.steps).toEqual([
      "classifier",
      "extractStep",
      "clarifyStep",
      "analysisStep",
      "riskStep",
      "summaryStep",
    ]);
  });

  it("routes requirement status queries without triggering business agents", async () => {
    const result = await runAnalysisGraph(
      "查询 REQ-20240315-001 的当前状态",
    );

    expect(result.intent).toBe("query");
    expect(result.queryResponse).toBeTruthy();
    expect(result.summary).toBe(result.queryResponse!);
    expect(result.extracted).toBeUndefined();
    expect(result.analysisResult).toBeUndefined();
    expect(result.riskResult).toBeUndefined();
    expect(result.steps).toEqual(["classifier", "queryHandler"]);
    expect(extractInvoke).not.toHaveBeenCalled();
  });

  it("routes casual chat through the short path in under five seconds", async () => {
    const startedAt = performance.now();
    const result = await runAnalysisGraph("你好，今天天气不错");
    const elapsedMs = performance.now() - startedAt;

    expect(result.intent).toBe("chat");
    expect(result.chatResponse).toBeTruthy();
    expect(result.summary).toBe(result.chatResponse!);
    expect(result.steps).toEqual(["classifier", "chatHandler"]);
    expect(extractInvoke).not.toHaveBeenCalled();
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("uses deterministic fallback when structured classification fails", async () => {
    classifierShouldFail = true;

    expect(
      (await runAnalysisGraph("REQ-20240415-002 的进度如何")).intent,
    ).toBe("query");
    expect(classifyIntentByKeywords("你好，今天天气不错")).toBe("chat");
    expect(classifyIntentByKeywords("我需要一个用户登录功能")).toBe(
      "analyze",
    );
  });

  it("classifies at least six of the seven acceptance inputs correctly", async () => {
    const cases: Array<{
      input: string;
      expected: Array<"analyze" | "query" | "chat">;
    }> = [
      {
        input:
          "分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型和结果统计",
        expected: ["analyze"],
      },
      {
        input: "查询 REQ-20240315-001 的当前状态",
        expected: ["query"],
      },
      { input: "你好，今天天气不错", expected: ["chat"] },
      {
        input: "看看 REQ-20240315-001 有没有什么问题",
        expected: ["analyze", "query"],
      },
      { input: "REQ-20240415-002 的进度如何", expected: ["query"] },
      { input: "我需要一个用户登录功能", expected: ["analyze"] },
      {
        input: "查询 REQ-20240315-001 的风险分析报告",
        expected: ["query"],
      },
    ];

    let correct = 0;
    for (const testCase of cases) {
      const result = await runAnalysisGraph(testCase.input);
      if (testCase.expected.includes(result.intent)) {
        correct += 1;
      }
    }

    expect(correct).toBeGreaterThanOrEqual(6);
  });

  it("keeps the Ch6 entry and delegates to the graph", async () => {
    await expect(runRequirementAnalysis("我需要一个用户登录功能")).resolves.toBe(
      "最终需求分析报告",
    );
  });
});
