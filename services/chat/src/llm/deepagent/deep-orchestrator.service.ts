import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  createDeepAgent,
  type AnyBackendProtocol,
  type CompiledSubAgent,
  type FilesystemPermission,
} from "deepagents";
import { z } from "zod";
import { createAnalysisGraph } from "../graph/requirement-analysis-graph";

const ANALYSIS_SUBAGENT_NAME = "requirement_analysis";

export interface SaveReportInput {
  title: string;
  report: string;
}

export interface CreateDeepOrchestratorOptions {
  model: BaseChatModel;
  /** 父链路已取得的知识库资料，传给内部需求分析图而不是重新检索。 */
  retrievedContext?: string;
  backend?: AnyBackendProtocol;
  checkpointer?: BaseCheckpointSaver | boolean;
  permissions?: FilesystemPermission[];
  /**
   * 将 save_report 设为中断工具时必须传入 checkpointer，确保批准/拒绝后可恢复。
   * 布尔值覆盖最小演示场景；高级 interrupt 配置可在调用方扩展后传入。
   */
  interruptOn?: Record<string, boolean>;
  /** 可选报告保存器；未提供时，工具只返回保存确认，不写入现有业务库。 */
  saveReport?: (input: SaveReportInput) => Promise<string> | string;
}

type MessagesInput = {
  messages?: BaseMessage[];
};

function getLatestHumanText(messages: BaseMessage[] = []): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof HumanMessage) && message.getType() !== "human") {
      continue;
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
        )
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }

  throw new Error("需求分析子代理未收到用户输入");
}

/**
 * 将第八、九章既有分析图适配为 DeepAgent 可调度的 CompiledSubAgent。
 * 子代理边界只传回汇总文本，不暴露 extracted、risk 等图内部状态。
 */
export function createAnalysisSubagent(
  model: BaseChatModel,
  options: { retrievedContext?: string } = {},
): CompiledSubAgent {
  const graph = createAnalysisGraph(model);
  const runnable = RunnableLambda.from(async ({ messages }: MessagesInput) => {
    const input = getLatestHumanText(messages);
    const state = await graph.invoke({
      input,
      retrievedContext: options.retrievedContext ?? "",
      messages: [],
    });
    const summary =
      state.summary?.trim() ||
      state.analysisResult?.trim() ||
      state.analysis?.trim() ||
      "需求分析未生成有效结论。";

    return { messages: [new AIMessage(summary)] };
  });

  return {
    name: ANALYSIS_SUBAGENT_NAME,
    description: "调用既有 LangGraph 需求分析流程，输出需求拆解、风险和综合报告。",
    runnable,
  };
}

function createSaveReportTool(
  saveReport?: CreateDeepOrchestratorOptions["saveReport"],
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "save_report",
    description: "保存已经完成的需求分析报告。仅在用户明确要求保存、归档或导出报告时调用。",
    schema: z.object({
      title: z.string().min(1).describe("报告标题"),
      report: z.string().min(1).describe("需要保存的完整报告内容"),
    }),
    func: async (input) => {
      if (saveReport) {
        return saveReport(input);
      }
      return `报告“${input.title}”已准备保存（当前演示未配置持久化保存器）。`;
    },
  });
}

/**
 * 创建独立的 DeepAgent 编排器。该工厂暂不接入现有 OrchestratorService 或 SSE 路由，
 * 供后续试验新的子代理调度与 HITL 工作流时显式调用。
 */
export function createDeepOrchestrator(options: CreateDeepOrchestratorOptions) {
  if (options.interruptOn && !options.checkpointer) {
    throw new Error("配置 interruptOn 时必须提供 checkpointer，以便中断后恢复执行。");
  }

  const analysisSubagent = createAnalysisSubagent(options.model, {
    retrievedContext: options.retrievedContext,
  });
  const saveReport = createSaveReportTool(options.saveReport);

  return createDeepAgent({
    model: options.model,
    tools: [saveReport],
    subagents: [analysisSubagent],
    systemPrompt: `你是需求分析编排助手。

当用户需要提交、拆解、评估或分析需求时，委派给 requirement_analysis 子代理。
当用户明确要求保存或归档完成的报告时，调用 save_report。
只向用户展示清晰的最终结论，不暴露子图的内部状态。`,
    backend: options.backend,
    checkpointer: options.checkpointer,
    permissions: options.permissions,
    interruptOn: options.interruptOn,
  });
}
