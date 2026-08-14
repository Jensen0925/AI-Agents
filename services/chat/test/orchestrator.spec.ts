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

const runAnalysisGraph = mock(async (_input: string, _context?: string) => ({
  messages: [],
  intent: "analyze" as const,
  extracted: "需求字段",
  clarified: JSON.stringify({ needsClarification: false, questions: [] }),
  analysisResult: "需求分析结果",
  riskResult: "风险评估结果",
  summary: "完整需求分析报告",
  steps: [
    "classifier" as const,
    "extractStep" as const,
    "clarifyStep" as const,
    "analysisStep" as const,
    "riskStep" as const,
    "summaryStep" as const,
  ],
}));

mock.module("../src/llm/graph/analysis-graph.runner", () => ({
  runAnalysisGraph,
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

  it("converts interrupted multi-expert output into compatible UI components", () => {
    const response = new OrchestratorService().toUIResponse({
      mode: "fixed",
      status: "clarification_required",
      clarificationQuestions: ["请补充目标用户。"],
      usedAgents: ["extractAgent", "clarifyAgent"],
      fallback: null,
      steps: [],
      report: null,
      interrupted: true,
      activeExperts: ["functional", "security"],
    });

    expect(response.components[0]).toMatchObject({ type: "confirmation" });
    expect(response.components[1]).toMatchObject({
      type: "steps",
      steps: [
        { key: "functional_expert" },
        { key: "security_expert" },
      ],
    });
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

  beforeEach(() => {
    runAnalysisGraph.mockClear();
    runAnalysisGraph.mockImplementation(async () => ({
      messages: [],
      intent: "analyze" as const,
      extracted: "需求字段",
      clarified: JSON.stringify({ needsClarification: false, questions: [] }),
      analysisResult: "需求分析结果",
      riskResult: "风险评估结果",
      summary: "完整需求分析报告",
      steps: [
        "classifier" as const,
        "extractStep" as const,
        "clarifyStep" as const,
        "analysisStep" as const,
        "riskStep" as const,
        "summaryStep" as const,
      ],
    }));
  });

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
    const search = mock(async () => [
      { content: "需求必须支持上下文裁剪", score: 0.82 },
    ]);
    const service = new AdvancedAnalysisService(
      { orchestrate } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages,
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );
    const input = "帮我判断这个需求是否完整，并产出一份需求分析报告";

    const result = await service.analyze("user-1", "conversation-1", input);

    expect(orchestrate).not.toHaveBeenCalled();
    expect(runAnalysisGraph).toHaveBeenCalledTimes(1);
    expect(runAnalysisGraph.mock.calls[0]?.[0]).toBe(input);
    expect(runAnalysisGraph.mock.calls[0]?.[1]).toContain("REQ-2026-001");
    expect(runAnalysisGraph.mock.calls[0]?.[1]).toContain("需求必须支持上下文裁剪");
    expect(search).toHaveBeenCalledWith(input, "user-1", 3);
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
      status: "completed",
      fallback: null,
      intent: "analyze",
      summary: completedResult.report,
      clarificationQuestions: [],
      usedAgents: completedResult.usedAgents,
      retrievedDocuments: [
        { content: "需求必须支持上下文裁剪", score: 0.82 },
      ],
      queryResponse: undefined,
      chatResponse: undefined,
      steps: [
        "classifier",
        "extractStep",
        "clarifyStep",
        "analysisStep",
        "riskStep",
        "summaryStep",
      ],
    });
  });

  it("archives a completed analysis report without making artifact failure part of chat success", async () => {
    const addMessage = mock(async () => undefined);
    const upsertGeneratedReport = mock(async () => ({ id: "artifact-1" }));
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => []),
        addMessage,
      } as unknown as MessageService,
      { search: mock(async () => []) } as unknown as SearchService,
      { upsertGeneratedReport } as never,
    );

    const result = await service.analyze(
      "user-1",
      "conversation-1",
      "请分析用户登录需求并输出报告",
    );

    expect(result.report).toBeTruthy();
    expect(upsertGeneratedReport).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      userId: "user-1",
      title: "请分析用户登录需求并输出报告",
      content: result.report,
    });
  });

  it("persists clarification questions as the assistant conclusion", async () => {
    runAnalysisGraph.mockImplementation(async () => {
      throw new Error("graph unavailable");
    });
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
    const search = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages,
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );
    const result = await service.analyze(
      "user-1",
      "conversation-1",
      "分析这个需求",
    );

    expect(result.report).toBeNull();
    expect(result.status).toBe("clarification_required");
    expect(result.summary).toContain("请明确系统支持的最大上下文长度");
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(addMessage.mock.calls[1]?.[2]).toContain(
      "请明确系统支持的最大上下文长度",
    );
  });

  it("returns a displayable local report when both model paths fail", async () => {
    runAnalysisGraph.mockImplementation(async () => {
      throw new Error("graph unavailable");
    });
    const orchestrate = mock(async () => ({
      ...completedResult,
      status: "failed" as const,
      fallback: "manual_review" as const,
      usedAgents: ["extractAgent" as const],
      report: null,
    }));
    const addMessage = mock(
      async (
        _conversationId: string,
        _role: MessageRole,
        _content: string,
        _metadata?: unknown,
      ) => undefined,
    );
    const service = new AdvancedAnalysisService(
      { orchestrate } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => []),
        addMessage,
      } as unknown as MessageService,
      { search: mock(async () => []) } as unknown as SearchService,
    );

    const result = await service.analyze(
      "user-1",
      "conversation-1",
      "分析用户登录需求",
    );

    expect(result.status).toBe("failed");
    expect(result.fallback).toBe("manual_review");
    expect(result.report).toContain("## 需求摘要");
    expect(result.report).toContain("## 功能分解");
    expect(result.summary).toContain("## 技术复杂度");
    expect(addMessage.mock.calls[1]?.[2]).toContain("## 开发排期");
  });

  it("answers casual chat without invoking retrieval or the analysis graph", async () => {
    const runMock = runAnalysisGraph;
    const addMessage = mock(async () => undefined);
    const search = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => []),
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );

    const result = await service.analyze(
      "user-1",
      "conversation-chat",
      "你好，今天天气真不错",
    );

    expect(runMock).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(result.intent).toBe("chat");
    expect(result.report).toBeNull();
    expect(result.summary).not.toContain("## 需求摘要");
    expect(addMessage).toHaveBeenCalledTimes(2);
  });

  it("asks targeted questions for a brief login requirement", async () => {
    const runMock = runAnalysisGraph;
    const addMessage = mock(async () => undefined);
    const search = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => []),
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );

    const result = await service.analyze(
      "user-1",
      "conversation-login",
      "我想做一个登录",
    );

    expect(runMock).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(result.status).toBe("clarification_required");
    expect(result.intent).toBe("analyze");
    expect(result.report).toBeNull();
    expect(result.summary).toContain("登录方式");
    expect(result.summary).not.toContain("## 需求摘要");
  });

  it("advances login clarification from answers already stored in the same conversation", async () => {
    const persisted: Array<HumanMessage | AIMessage> = [];
    const addMessage = mock(
      async (
        _conversationId: string,
        role: MessageRole,
        content: string,
      ) => {
        persisted.push(
          role === MessageRole.USER
            ? new HumanMessage(content)
            : new AIMessage(content),
        );
      },
    );
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => [...persisted]),
        addMessage,
      } as unknown as MessageService,
      { search: mock(async () => []) } as unknown as SearchService,
    );

    const first = await service.analyze(
      "user-1",
      "conversation-login-flow",
      "我想做一个登录页面",
    );
    const second = await service.analyze(
      "user-1",
      "conversation-login-flow",
      "验证码登录",
    );
    const third = await service.analyze(
      "user-1",
      "conversation-login-flow",
      "登录方式是账号密码",
    );
    const fourth = await service.analyze(
      "user-1",
      "conversation-login-flow",
      "管理员和普通用户",
    );

    expect(first.summary).toContain("登录方式选哪一种");
    expect(second.summary).toContain("已记录：登录方式：验证码登录");
    expect(second.summary).toContain("用户角色有哪些");
    expect(third.summary).toContain("已记录：登录方式：登录方式是账号密码");
    expect(third.summary).toContain("用户角色有哪些");
    expect(fourth.summary).toContain("用户角色：管理员和普通用户");
    expect(fourth.summary).toContain("安全规则需要哪些");
    expect(fourth.summary).not.toContain("登录方式选哪一种");
    expect(runAnalysisGraph).not.toHaveBeenCalled();
  });

  it("keeps a complete login destination answer on the clarification path", async () => {
    const persisted: Array<HumanMessage | AIMessage> = [];
    const addMessage = mock(
      async (
        _conversationId: string,
        role: MessageRole,
        content: string,
      ) => {
        persisted.push(
          role === MessageRole.USER
            ? new HumanMessage(content)
            : new AIMessage(content),
        );
      },
    );
    const search = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => [...persisted]),
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );

    await service.analyze(
      "user-1",
      "conversation-sso-flow",
      "我想做一个单点登录",
    );
    await service.analyze("user-1", "conversation-sso-flow", "sso");
    await service.analyze("user-1", "conversation-sso-flow", "管理员");
    await service.analyze(
      "user-1",
      "conversation-sso-flow",
      "验证码保护、连续失败锁定、找回密码、",
    );
    const result = await service.analyze(
      "user-1",
      "conversation-sso-flow",
      "登录成功后要跳转到主页 登录状态或会话有效期需要保持1天",
    );

    expect(result.status).toBe("clarification_required");
    expect(result.intent).toBe("analyze");
    expect(result.summary).toContain("登录后行为");
    expect(result.summary).toContain("关键信息已齐全");
    expect(runAnalysisGraph).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("explains the missing order data source and keeps query context on follow-up", async () => {
    const persisted: Array<HumanMessage | AIMessage> = [];
    const addMessage = mock(
      async (
        _conversationId: string,
        role: MessageRole,
        content: string,
      ) => {
        persisted.push(
          role === MessageRole.USER
            ? new HumanMessage(content)
            : new AIMessage(content),
        );
      },
    );
    const search = mock(async () => []);
    const service = new AdvancedAnalysisService(
      { orchestrate: mock(async () => completedResult) } as unknown as OrchestratorServiceType,
      {
        getHistoryAsLangChainMessages: mock(async () => [...persisted]),
        addMessage,
      } as unknown as MessageService,
      { search } as unknown as SearchService,
    );

    const identity = await service.analyze(
      "user-1",
      "conversation-order-flow",
      "你好，你是什么模型",
    );
    const orderQuery = await service.analyze(
      "user-1",
      "conversation-order-flow",
      "我想查询一下订单",
    );
    const followUp = await service.analyze(
      "user-1",
      "conversation-order-flow",
      "为什么不能查询",
    );

    expect(identity.summary).toContain("底层模型由服务端当前的模型配置决定");
    expect(orderQuery.status).toBe("completed");
    expect(orderQuery.intent).toBe("query");
    expect(orderQuery.summary).toContain("订单号");
    expect(orderQuery.summary).toContain("没有接入真实订单数据源");
    expect(orderQuery.summary).not.toContain("需求详情");
    expect(followUp.summary).toContain("没有接入订单数据库或订单查询 API");
    expect(followUp.summary).toContain("不能编造订单状态");
    expect(followUp.summary).not.toContain("请稍后重试");
    expect(runAnalysisGraph).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});
