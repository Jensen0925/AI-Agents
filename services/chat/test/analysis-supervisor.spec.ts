import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "bun:test";
import {
  createAnalysisSupervisorSubGraph,
  createFunctionalExpert,
  routeToExperts,
} from "../src/llm/graph/experts";

type MessageLike = { content: unknown };

function textOf(content: unknown): string {
  return typeof content === "string" ? content : "";
}

function createSupervisorModel(activeExperts: string[]) {
  const calls: string[] = [];

  const model = {
    withStructuredOutput: () => ({
      invoke: async () => ({
        activeExperts,
        reasoning: "测试路由",
      }),
    }),
    invoke: async (messages: MessageLike[]) => {
      const system = textOf(messages[0]?.content);
      const user = textOf(messages.at(-1)?.content);

      if (system.includes("功能需求专家")) {
        calls.push("functional");
        return new AIMessage("功能结论：拆分批量导入流程与验收标准。");
      }
      if (system.includes("性能与可靠性专家")) {
        calls.push("performance");
        return new AIMessage("性能结论：需要定义批处理容量和时延指标。");
      }
      if (system.includes("安全专家")) {
        calls.push("security");
        return new AIMessage("安全结论：需要校验上传文件并隔离用户数据。");
      }
      if (system.includes("合规与治理专家")) {
        calls.push("compliance");
        return new AIMessage("合规结论：需要明确数据保存期限。");
      }
      if (system.includes("汇总负责人")) {
        calls.push("aggregator");
        expect(user).toContain("功能结论");
        expect(user).toContain("安全结论");
        expect(user).not.toContain("性能结论");
        expect(user).not.toContain("合规结论");
        return new AIMessage("汇总结论：功能和安全方案已完成。");
      }

      throw new Error(`Unexpected model call: ${system}`);
    },
  } as unknown as BaseChatModel;

  return { model, calls };
}

describe("analysis supervisor subgraph", () => {
  it("routes to multiple selected experts in parallel and aggregates only them", async () => {
    const { model, calls } = createSupervisorModel([
      "functional",
      "security",
    ]);
    const graph = createAnalysisSupervisorSubGraph(model);

    const result = await graph.invoke({
      input: "实现 Excel 批量导入，并确保不同用户的数据隔离",
      messages: [
        new HumanMessage("实现 Excel 批量导入，并确保不同用户的数据隔离"),
      ],
      extracted: "批量导入 Excel；用户数据隔离",
      retrievedContext: "上传文件必须限制格式和大小。",
    });

    expect(result.activeExperts).toEqual(["functional", "security"]);
    expect(result.functionalAnalysis).toContain("功能结论");
    expect(result.securityAnalysis).toContain("安全结论");
    expect(result.performanceAnalysis).toBe("");
    expect(result.complianceAnalysis).toBe("");
    expect(result.analysisResult).toContain("汇总结论");
    expect(new Set(calls.slice(0, 2))).toEqual(
      new Set(["functional", "security"]),
    );
    expect(calls.at(-1)).toBe("aggregator");
    expect(calls.filter((call) => call === "aggregator")).toHaveLength(1);
  });

  it("returns an array of expert nodes for parallel conditional routing", () => {
    const routes = routeToExperts({
      activeExperts: ["performance", "compliance"],
    } as Parameters<typeof routeToExperts>[0]);

    expect(routes).toEqual(["performanceExpert", "complianceExpert"]);
  });

  it("degrades one unavailable expert without aborting its subgraph", async () => {
    const unavailableModel = {
      invoke: async () => {
        throw new Error("mock model unavailable");
      },
    } as unknown as BaseChatModel;
    const graph = createFunctionalExpert(unavailableModel);

    const result = await graph.invoke({
      input: "开发一个用户登录功能",
      messages: [new HumanMessage("开发一个用户登录功能")],
    });

    expect(result.functionalAnalysis).toContain("[功能 专家暂不可用：mock model unavailable]");
    expect(result.functionalAnalysis).toContain("建议人工补充");
  });

  it("uses the injected downgrade model when the monthly budget is tight", async () => {
    const originalBudget = process.env.MONTHLY_BUDGET_USD;
    process.env.MONTHLY_BUDGET_USD = "10";

    const defaultModel = {
      invoke: async () => new AIMessage("不应使用默认模型"),
    } as unknown as BaseChatModel;
    const downgradedModel = {
      invoke: async () => new AIMessage("已使用降级模型完成轻量功能分析。"),
    } as unknown as BaseChatModel;
    const usageService = {
      getMonthlyStats: async () => ({
        totalCost: 8.5,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        calls: 1,
      }),
      recordUsage: async () => undefined,
    };

    try {
      const graph = createFunctionalExpert(
        defaultModel,
        usageService as never,
        undefined,
        (agentName, action) => {
          expect(agentName).toBe("functional_expert");
          expect(action).toBe("downgrade");
          return downgradedModel;
        },
      );
      const result = await graph.invoke({
        input: "开发一个用户登录功能",
        messages: [new HumanMessage("开发一个用户登录功能")],
      });

      expect(result.functionalAnalysis).toContain("已使用降级模型");
    } finally {
      if (originalBudget === undefined) {
        delete process.env.MONTHLY_BUDGET_USD;
      } else {
        process.env.MONTHLY_BUDGET_USD = originalBudget;
      }
    }
  });

  it("keeps the degradation marker available to the aggregator", async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          activeExperts: ["functional"],
          reasoning: "测试专家降级汇总",
        }),
      }),
      invoke: async (messages: MessageLike[]) => {
        const system = textOf(messages[0]?.content);
        if (system.includes("功能需求专家")) {
          throw new Error("functional mock failure");
        }
        if (system.includes("汇总负责人")) {
          return new AIMessage("汇总报告已保留人工补充标记。");
        }
        throw new Error(`Unexpected model call: ${system}`);
      },
    } as unknown as BaseChatModel;
    const graph = createAnalysisSupervisorSubGraph(model);
    const result = await graph.invoke({
      input: "开发用户登录功能",
      messages: [new HumanMessage("开发用户登录功能")],
    });

    expect(result.functionalAnalysis).toContain("专家暂不可用");
    expect(result.analysisResult).toContain("人工补充标记");
  });
});
