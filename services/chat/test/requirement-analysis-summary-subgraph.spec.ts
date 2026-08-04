import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, mock } from "bun:test";

type CritiqueResult = {
  pass: boolean;
  critique: string;
  issues?: string[];
};

function createFakeModel(critiqueResults: CritiqueResult[]) {
  let actorCalls = 0;
  let criticCalls = 0;

  const model = {
    invoke: async (messages: Array<{ content: unknown }>) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("根据评审意见修订报告")) {
        actorCalls += 1;
        return new AIMessage(
          `## 修订后的综合报告\n\n第 ${actorCalls} 次修订已补充排期依赖和冲突解决方案。`,
        );
      }

      actorCalls += 1;
      return new AIMessage(
        "## 需求摘要\n\n初版报告。\n\n## 冲突分析\n\n暂无冲突。\n\n## 技术复杂度\n\n中。\n\n## 开发排期\n\n阶段一依赖需求确认。",
      );
    },
    withStructuredOutput: () => ({
      invoke: async () => {
        const result =
          critiqueResults[Math.min(criticCalls, critiqueResults.length - 1)];
        criticCalls += 1;
        return result;
      },
    }),
  };

  return model;
}

mock.module("../src/llm/model.factory", () => ({
  createChatModel: () => createFakeModel([{ pass: true, critique: "" }]),
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

const { createSummarySubGraph, MAX_SUMMARY_REVISIONS } = require(
  "../src/llm/graph/requirement-analysis-graph",
) as typeof import("../src/llm/graph/requirement-analysis-graph");

describe("requirement analysis Critic-Refine summary subgraph", () => {
  it("returns the actor report when the first critic passes", async () => {
    const model = createFakeModel([{ pass: true, critique: "" }]);
    const graph = createSummarySubGraph(model as never);
    const result = await graph.invoke({
      input: "开发一个需求分析助手",
      extracted: "功能：需求抽取",
      analysisResult: "功能分解：输入、分析、输出",
      riskResult: "风险：上下文过长",
    });

    expect(result.summary).toContain("初版报告");
    expect(result.critique).toBe("");
    expect(result.reviseCount).toBe(0);
  });

  it("refines once and then stops after a passing review", async () => {
    const model = createFakeModel([
      { pass: false, critique: "请补充冲突解决方案" },
      { pass: true, critique: "" },
    ]);
    const graph = createSummarySubGraph(model as never);
    const result = await graph.invoke({ input: "开发一个需求分析助手" });

    expect(result.summary).toContain("修订后的综合报告");
    expect(result.reviseCount).toBe(1);
    expect(result.critique).toBe("");
  });

  it("hard-stops after the configured maximum revisions", async () => {
    const model = createFakeModel([
      { pass: false, critique: "请补充摘要" },
    ]);
    const graph = createSummarySubGraph(model as never);
    const result = await graph.invoke({ input: "开发一个需求分析助手" });

    expect(result.reviseCount).toBe(MAX_SUMMARY_REVISIONS);
    expect(result.summary).toBeTruthy();
    expect(result.critique).toContain("请补充摘要");
  });
});
