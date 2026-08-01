import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { MessageRole } from "@prisma/client";
import type { SearchService } from "../src/document/search.service";
import type { OrchestratorService as OrchestratorServiceType } from "../src/llm/agents/orchestrator.service";
import type { MessageService } from "../src/message/message.service";

const extractInvoke = mock(async () =>
  JSON.stringify({
    title: "会话记忆系统",
    actors: ["需求分析师"],
    goals: ["支持多轮澄清"],
    functionalRequirements: ["保存会话上下文"],
    nonFunctionalRequirements: [],
    constraints: ["自动裁剪长对话上下文"],
    unknowns: [],
  }),
);
const clarifyInvoke = mock(async () =>
  JSON.stringify({ needsClarification: false, questions: [] }),
);
const analysisInvoke = mock(async () => "需求分析结果");
const riskInvoke = mock(async () => "风险评估结果");
const summaryInvoke = mock(async () => "最终需求分析报告");

mock.module("../src/llm/agents/sub-agents", () => ({
  extractAgent: { invoke: extractInvoke },
  clarifyAgent: { invoke: clarifyInvoke },
  analysisAgent: { invoke: analysisInvoke },
  riskAgent: { invoke: riskInvoke },
  summaryAgent: { invoke: summaryInvoke },
}));

const { OrchestratorService } = require(
  "../src/llm/agents/orchestrator.service"
) as typeof import("../src/llm/agents/orchestrator.service");
const { AdvancedAnalysisService } = require(
  "../src/llm/advanced-analysis.service"
) as typeof import("../src/llm/advanced-analysis.service");

const INPUT =
  "开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文";

describe("OrchestratorService", () => {
  beforeEach(() => {
    extractInvoke.mockClear();
    clarifyInvoke.mockClear();
    analysisInvoke.mockClear();
    riskInvoke.mockClear();
    summaryInvoke.mockClear();
    clarifyInvoke.mockImplementation(async () =>
      JSON.stringify({ needsClarification: false, questions: [] }),
    );
    analysisInvoke.mockImplementation(async () => "需求分析结果");
    riskInvoke.mockImplementation(async () => "风险评估结果");
  });

  it("runs the five-agent fixed workflow", async () => {
    const result = await new OrchestratorService().orchestrate(INPUT);

    expect(result.status).toBe("completed");
    expect(result.usedAgents).toEqual([
      "extractAgent",
      "clarifyAgent",
      "analysisAgent",
      "riskAgent",
      "summaryAgent",
    ]);
    expect(result.fallback).toBeNull();
    expect(result.report).toBe("最终需求分析报告");
    expect(result.steps).toHaveLength(5);
  });

  it("stops after clarification questions are generated", async () => {
    clarifyInvoke.mockImplementation(async () =>
      JSON.stringify({
        needsClarification: true,
        questions: ["需要保留多少轮对话？"],
      }),
    );

    const result = await new OrchestratorService().orchestrate(INPUT);

    expect(result.status).toBe("clarification_required");
    expect(result.clarificationQuestions).toEqual(["需要保留多少轮对话？"]);
    expect(result.usedAgents).toEqual(["extractAgent", "clarifyAgent"]);
    expect(analysisInvoke).not.toHaveBeenCalled();
    expect(summaryInvoke).not.toHaveBeenCalled();
  });

  it("falls back to manual review when a parallel agent fails", async () => {
    riskInvoke.mockImplementation(async () => {
      throw new Error("risk agent unavailable");
    });

    const result = await new OrchestratorService().orchestrate(INPUT);

    expect(result.status).toBe("failed");
    expect(result.fallback).toBe("manual_review");
    expect(result.steps.at(-1)).toEqual({
      agent: "riskAgent",
      status: "failed",
      error: "risk agent unavailable",
    });
    expect(summaryInvoke).not.toHaveBeenCalled();
  });
});

describe("AdvancedAnalysisService", () => {
  const completedResult = {
    mode: "fixed" as const,
    status: "completed" as const,
    clarificationQuestions: [],
    usedAgents: [
      "extractAgent" as const,
      "clarifyAgent" as const,
      "analysisAgent" as const,
      "riskAgent" as const,
      "summaryAgent" as const,
    ],
    fallback: null,
    steps: [],
    report: "完整需求分析报告",
  };

  it("combines DB history and retrieved context, then persists the conclusion", async () => {
    const orchestrate = mock(
      async (_input: string, _retrievedContext: string) => completedResult,
    );
    const getHistoryAsLangChainMessages = mock(async () => [
      new HumanMessage("需求单号是 REQ-2026-001"),
      new AIMessage("已记录需求单号"),
    ]);
    const addMessage = mock(
      async (
        _conversationId: string,
        _role: MessageRole,
        _content: string,
        _metadata?: unknown,
      ) => undefined,
    );
    const similaritySearch = mock(async () => [
      { content: "需求必须支持上下文裁剪", score: 0.82 },
    ]);
    const service = new AdvancedAnalysisService(
      { orchestrate } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages,
        addMessage,
      } as unknown as MessageService,
      { similaritySearch } as unknown as SearchService,
    );
    const input = "帮我判断这个需求是否完整，并产出一份需求分析报告";

    const result = await service.analyze("user-1", "conversation-1", input);

    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0]?.[0]).toContain("REQ-2026-001");
    expect(orchestrate.mock.calls[0]?.[0]).toContain(input);
    expect(orchestrate.mock.calls[0]?.[1]).toContain("需求必须支持上下文裁剪");
    expect(similaritySearch).toHaveBeenCalledWith(input, "user-1", 3);
    expect(addMessage.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["conversation-1", MessageRole.USER, input],
      [
        "conversation-1",
        MessageRole.ASSISTANT,
        completedResult.report,
      ],
    ]);
    expect(result).toEqual({
      report: completedResult.report,
      usedAgents: completedResult.usedAgents,
      retrievedDocuments: [
        { content: "需求必须支持上下文裁剪", score: 0.82 },
      ],
    });
  });

  it("persists clarification questions as the assistant conclusion", async () => {
    const orchestrate = mock(async () => ({
      ...completedResult,
      status: "clarification_required" as const,
      clarificationQuestions: ["请明确系统支持的最大上下文长度"],
      usedAgents: ["extractAgent" as const, "clarifyAgent" as const],
      report: null,
    }));
    const getHistoryAsLangChainMessages = mock(async () => []);
    const addMessage = mock(
      async (
        _conversationId: string,
        _role: MessageRole,
        _content: string,
        _metadata?: unknown,
      ) => undefined,
    );
    const similaritySearch = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages,
        addMessage,
      } as unknown as MessageService,
      { similaritySearch } as unknown as SearchService,
    );
    const result = await service.analyze(
      "user-1",
      "conversation-1",
      "分析这个需求",
    );

    expect(result.report).toBeNull();
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(addMessage.mock.calls[1]?.[2]).toContain(
      "请明确系统支持的最大上下文长度",
    );
  });
});
