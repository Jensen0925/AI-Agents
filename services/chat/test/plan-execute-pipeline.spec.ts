import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "bun:test";
import {
  PipelineState,
  evaluatorNode,
  plannerNode,
  reflectorNode,
  routeAfterEvaluator,
  routeAfterExecutor,
  type PipelineStateValue,
} from "../src/llm/graph/plan-execute-pipeline";

function createModel() {
  const structuredResults: unknown[] = [
    { steps: [{ id: "one", description: "分析第一个工单" }, { id: "two", description: "分析第二个工单" }] },
    { pass: false, feedback: "需要补充工单间依赖关系" },
    { steps: [{ id: "dependencies", description: "补充工单间依赖关系" }] },
  ];
  return {
    withStructuredOutput: () => ({
      invoke: async () => structuredResults.shift(),
    }),
    invoke: async () => new AIMessage("步骤结论"),
  } as unknown as BaseChatModel;
}

function state(overrides: Partial<PipelineStateValue> = {}): PipelineStateValue {
  return {
    input: "联合分析多个需求工单",
    plan: [{ id: "one", description: "分析工单", done: false }],
    currentStepIndex: 0,
    stepResults: {},
    reflections: [],
    retryCount: 0,
    parentThreadId: "parent-1",
    finalReport: "",
    ...overrides,
  };
}

describe("plan-execute pipeline", () => {
  it("planner creates an executable plan with a deterministic fallback contract", async () => {
    const result = await plannerNode(state(), { model: createModel() });
    expect(result.plan).toEqual([
      { id: "one", description: "分析第一个工单", done: false },
      { id: "two", description: "分析第二个工单", done: false },
    ]);
    expect(result.currentStepIndex).toBe(0);
  });

  it("routes executor back until all plan steps are done", () => {
    expect(routeAfterExecutor(state({ currentStepIndex: 0 }))).toBe("executor");
    expect(routeAfterExecutor(state({ currentStepIndex: 1 }))).toBe("evaluator");
  });

  it("reflects once and enforces the retry hard limit", async () => {
    const initial = state({
      plan: [{ id: "one", description: "原步骤", done: true }],
      currentStepIndex: 1,
      stepResults: { one: "原结论" },
      reflections: ["缺少依赖关系"],
    });
    const revised = await reflectorNode(initial, { model: createModel() });
    expect(revised.retryCount).toBe(1);
    expect(revised.currentStepIndex).toBe(0);
    expect(revised.stepResults).toEqual({});
    expect(routeAfterEvaluator(state({ retryCount: 1, reflections: ["问题"] }))).toBe("__end__");
  });

  it("evaluator preserves a report and records failed review feedback", async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          pass: false,
          feedback: "需要补充工单间依赖关系",
        }),
      }),
    } as unknown as BaseChatModel;
    const result = await evaluatorNode(
      state({ stepResults: { one: "功能结论", two: "风险结论" } }),
      { model },
    );
    expect(result.finalReport).toContain("功能结论");
    expect(result.reflections).toEqual(["需要补充工单间依赖关系"]);
  });

  it("exports the pipeline annotation for graph construction", () => {
    expect(PipelineState).toBeDefined();
  });
});
