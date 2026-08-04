import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, mock } from "bun:test";
import type {
  createAnalysisSubGraph as createAnalysisSubGraphType,
} from "../src/llm/graph/requirement-analysis-graph";

type ModelLike = Parameters<typeof createAnalysisSubGraphType>[0];

function getText(messages: Array<{ content: unknown }>): string {
  const last = messages.at(-1)?.content;
  return typeof last === "string" ? last : "";
}

function createFakeModel(options: {
  alwaysCallTool?: boolean;
  onInvoke?: (messages: Array<{ content: unknown; type?: string }>) => AIMessage;
}) {
  let calls = 0;
  const model = {
    bindTools: () => ({
      invoke: async (messages: Array<{ content: unknown; type?: string }>) => {
        calls += 1;
        if (options.onInvoke) {
          return options.onInvoke(messages);
        }

        if (options.alwaysCallTool) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "search_requirement",
                args: { reqId: "REQ-20240315-001" },
                id: `tool-${calls}`,
                type: "tool_call",
              },
            ],
          });
        }

        const hasToolResult = messages.some((message) => message.type === "tool");
        if (!hasToolResult && /REQ-[A-Z0-9-]+/i.test(getText(messages))) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "search_requirement",
                args: { reqId: "REQ-20240315-001" },
                id: `search-${calls}`,
                type: "tool_call",
              },
            ],
          });
        }

        if (!hasToolResult) {
          return new AIMessage({
            content:
              "功能分解：拆分核心流程。\n用户故事：用户完成主要任务。\n验收标准：主流程可验收。\n技术复杂度评估：中等。",
          });
        }

        return new AIMessage({
          content:
            "功能分解：基于需求详情拆分模块。\n用户故事：需求分析师可追踪进展。\n验收标准：关键场景通过验收。\n技术复杂度评估：中等。",
        });
      },
    }),
    get calls() {
      return calls;
    },
  } as unknown as ModelLike & { calls: number };

  return model;
}

// 该测试只验证图的编排和工具闭环，不应在导入 graph 时读取真实 YAML 或
// 初始化 OpenAI 客户端，因此把旧 Agent 和模型工厂替换成最小 fake。
const defaultModel = createFakeModel({});
mock.module("../src/llm/model.factory", () => ({
  createChatModel: () => defaultModel,
}));
mock.module("../src/llm/agents/sub-agents", () => {
  const noopAgent = { invoke: async () => "" };
  return {
    analysisAgent: noopAgent,
    extractAgent: noopAgent,
    clarifyAgent: noopAgent,
    riskAgent: noopAgent,
    summaryAgent: noopAgent,
  };
});

const { createAnalysisSubGraph, runAnalysisSubGraph } = require(
  "../src/llm/graph/requirement-analysis-graph",
) as typeof import("../src/llm/graph/requirement-analysis-graph");

describe("requirement analysis ReAct subgraph", () => {
  it("handles a normal requirement without tools", async () => {
    const model = createFakeModel({});
    const result = await runAnalysisSubGraph("我需要一个用户登录功能", {
      model,
    });

    expect(result.analysisResult).toContain("功能分解");
    expect(result.analysisResult).toContain("技术复杂度评估");
    expect(result.toolLoopCount).toBe(0);
    expect(result.steps).toEqual(["analysisAgent", "analysisFinalize"]);
  });

  it("looks up an existing requirement before producing analysis", async () => {
    const model = createFakeModel({});
    const result = await runAnalysisSubGraph(
      "请分析 REQ-20240315-001 的详情和实现风险",
      { model },
    );

    expect(result.messages.some((message) => message.type === "tool")).toBe(
      true,
    );
    expect(result.analysisResult).toContain("功能分解");
    expect(result.steps).toEqual([
      "analysisAgent",
      "analysisTools",
      "analysisAgent",
      "analysisFinalize",
    ]);
  });

  it("can execute the conflict tool for authentication requirements", async () => {
    const model = createFakeModel({
      onInvoke: (messages) => {
        const text = getText(messages);
        const hasSearchResult = messages.some(
          (message) => message.type === "tool" && text.includes("REQ-"),
        );

        if (!hasSearchResult) {
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "check_conflicts",
                args: {
                  reqId: "REQ-20240315-001",
                  description: "实现登录和认证能力",
                },
                id: "conflict-1",
                type: "tool_call",
              },
            ],
          });
        }

        return new AIMessage({
          content:
            "功能分解：登录、认证与会话管理。\n用户故事：用户安全登录。\n验收标准：认证失败有明确提示。\n技术复杂度评估：中高。",
        });
      },
    });
    const result = await runAnalysisSubGraph(
      "REQ-20240315-001：实现登录和认证能力",
      { model },
    );

    expect(result.messages.some((message) => message.type === "tool")).toBe(
      true,
    );
    expect(result.analysisResult).toContain("认证");
  });

  it("forces finalize after six tool rounds", async () => {
    const model = createFakeModel({ alwaysCallTool: true });
    const result = await runAnalysisSubGraph(
      "REQ-20240315-001 请持续查询直到完成",
      { model },
    );

    expect(result.toolLoopCount).toBe(6);
    expect(result.analysisResult).toContain("人工复核");
    expect(
      result.messages.filter((message) => message.type === "tool").length,
    ).toBe(6);
  });
});
