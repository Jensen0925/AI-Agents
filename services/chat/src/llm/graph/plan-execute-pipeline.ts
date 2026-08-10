import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  Annotation,
  END,
  START,
  StateGraph,
  type CompiledStateGraph,
} from "@langchain/langgraph";
import { z } from "zod";
import { createAnalysisGraph } from "./requirement-analysis-graph";

/** 单个跨工单分析步骤。done 由执行器更新，描述保持计划阶段的原意。 */
export interface PipelinePlanStep {
  id: string;
  description: string;
  done: boolean;
}

/**
 * Plan-and-Execute + Reflexion 的外层状态。
 * 业务字段统一采用覆盖型 reducer，避免重试时把旧结果追加到新一轮。
 */
export const PipelineState = Annotation.Root({
  input: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  plan: Annotation<PipelinePlanStep[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),
  currentStepIndex: Annotation<number>({
    reducer: (_current, next) => next,
    default: () => 0,
  }),
  stepResults: Annotation<Record<string, string>>({
    reducer: (_current, next) => next,
    default: () => ({}),
  }),
  reflections: Annotation<string[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),
  retryCount: Annotation<number>({
    reducer: (_current, next) => next,
    default: () => 0,
  }),
  parentThreadId: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "pipeline",
  }),
  finalReport: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
});

export type PipelineStateValue = typeof PipelineState.State;
export type PipelineNodeConfig = RunnableConfig & { model: BaseChatModel };

const planSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
    }),
  ).min(1).max(8),
});

const evaluationSchema = z.object({
  pass: z.boolean(),
  feedback: z.string().default(""),
});

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return value == null ? "" : String(value);
}

function lastMessageText(messages: BaseMessage[] | undefined): string {
  return textOf(messages?.at(-1)?.content);
}

async function invokeStructured<T>(model: BaseChatModel, schema: z.ZodType<T>, messages: BaseMessage[]): Promise<T> {
  const structured = (model as BaseChatModel & {
    withStructuredOutput?: (schema: unknown) => { invoke: (messages: BaseMessage[]) => Promise<T> };
  }).withStructuredOutput;
  if (typeof structured !== "function") throw new Error("Model does not support structured output");
  return structured.call(model, schema).invoke(messages);
}

/** 将大任务拆成可独立执行的跨工单步骤。 */
export async function plannerNode(
  state: PipelineStateValue,
  config: PipelineNodeConfig,
): Promise<Partial<PipelineStateValue>> {
  const input = state.input.trim();
  if (!input) throw new Error("Pipeline input cannot be empty");

  try {
    const result = await invokeStructured(config.model, planSchema, [
      new SystemMessage("你是跨工单需求分析计划员。请把任务拆成依赖清晰、可独立执行的分析步骤。每一步只做一件事。"),
      new HumanMessage(input),
    ]);
    const steps = result.steps.map((step, index) => ({
      id: step.id.trim() || `step-${index}`,
      description: step.description.trim(),
      done: false,
    }));
    return {
      plan: steps,
      currentStepIndex: 0,
      stepResults: {},
      finalReport: "",
    };
  } catch {
    // 模型暂不可用时仍然给出可执行的最小计划，保证流水线可观测且可重试。
    return {
      plan: [
        { id: "scope", description: "提取所有工单的目标、范围和关键约束", done: false },
        { id: "dependencies", description: "分析工单之间的依赖、冲突与风险", done: false },
        { id: "report", description: "汇总形成联合需求分析报告和后续建议", done: false },
      ],
      currentStepIndex: 0,
      stepResults: {},
      finalReport: "",
    };
  }
}

/** 执行当前计划项；每项使用独立 thread_id，互不污染会话状态。 */
export async function executorNode(
  state: PipelineStateValue,
  config: PipelineNodeConfig,
): Promise<Partial<PipelineStateValue>> {
  const step = state.plan[state.currentStepIndex];
  if (!step) {
    return { finalReport: Object.values(state.stepResults).filter(Boolean).join("\n\n") };
  }

  const threadId = `${state.parentThreadId}:step-${state.currentStepIndex}`;
  const graph = createAnalysisGraph(config.model);
  const prompt = [
    `联合分析任务：${state.input}`,
    `当前步骤（${step.id}）：${step.description}`,
    "请只返回本步骤的分析结论，保留可供汇总的事实、风险和建议。",
  ].join("\n\n");

  const result = await graph.invoke(
    { input: prompt, messages: [new HumanMessage(prompt)] },
    { configurable: { thread_id: threadId } },
  );
  const content = textOf(result?.summary || result?.analysisResult || lastMessageText(result?.messages));
  const stepResults = { ...state.stepResults, [step.id]: content || "本步骤未返回内容。" };
  const plan = state.plan.map((item, index) =>
    index === state.currentStepIndex ? { ...item, done: true } : item,
  );
  return {
    plan,
    stepResults,
    currentStepIndex: state.currentStepIndex + 1,
  };
}

/** 评估所有步骤结果是否足以形成可交付的联合报告。 */
export async function evaluatorNode(
  state: PipelineStateValue,
  config: PipelineNodeConfig,
): Promise<Partial<PipelineStateValue>> {
  const report = Object.entries(state.stepResults)
    .map(([id, result]) => `## ${id}\n${result}`)
    .join("\n\n");
  if (!report.trim()) {
    return {
      finalReport: "",
      reflections: [...state.reflections, "没有可评估的步骤结果"],
    };
  }

  try {
    const result = await invokeStructured(config.model, evaluationSchema, [
      new SystemMessage("你是需求分析报告评审员。判断联合报告是否完整、无明显矛盾且可以交付。"),
      new HumanMessage(`原始任务：${state.input}\n\n联合报告：\n${report}`),
    ]);
    return {
      finalReport: report,
      // 评审通过后清空当前反馈，条件边即可结束本轮；失败时保留反馈供
      // reflectorNode 修订计划。retryCount 仍是最终的硬上限。
      reflections: result.pass
        ? []
        : !result.feedback.trim()
          ? [...state.reflections, "报告未通过评审，请补充关键内容"]
          : [...state.reflections, result.feedback],
    };
  } catch {
    // 无结构化评审能力时，已有步骤结果作为保守可交付报告。
    return { finalReport: report, reflections: [] };
  }
}

/** 反思失败原因并修订计划；最多进入一次重跑。 */
export async function reflectorNode(
  state: PipelineStateValue,
  config: PipelineNodeConfig,
): Promise<Partial<PipelineStateValue>> {
  const feedback = state.reflections.at(-1) || "补充报告中的关键事实、依赖和可验证验收标准";
  try {
    const result = await invokeStructured(config.model, planSchema, [
      new SystemMessage("你是需求分析反思器。根据评审意见修订原计划，只补充必要步骤，并保持步骤可执行。"),
      new HumanMessage(`原计划：${JSON.stringify(state.plan)}\n评审意见：${feedback}`),
    ]);
    return {
      plan: result.steps.map((step, index) => ({
        id: step.id.trim() || `revision-${index}`,
        description: step.description.trim(),
        done: false,
      })),
      currentStepIndex: 0,
      stepResults: {},
      retryCount: state.retryCount + 1,
    };
  } catch {
    return {
      currentStepIndex: 0,
      stepResults: {},
      retryCount: state.retryCount + 1,
    };
  }
}

export function routeAfterExecutor(state: PipelineStateValue): "executor" | "evaluator" {
  return state.currentStepIndex < state.plan.length ? "executor" : "evaluator";
}

export function routeAfterEvaluator(state: PipelineStateValue): "reflector" | typeof END {
  if (state.retryCount >= 1 || state.reflections.length === 0) return END;
  return "reflector";
}

/** 创建 Plan-and-Execute + Reflexion 外层图。 */
export function createPlanExecutePipeline(
  model: BaseChatModel,
): CompiledStateGraph<any, any, any> {
  return new StateGraph(PipelineState)
    .addNode("planner", (state) => plannerNode(state, { model }))
    .addNode("executor", (state) => executorNode(state, { model }))
    .addNode("evaluator", (state) => evaluatorNode(state, { model }))
    .addNode("reflector", (state) => reflectorNode(state, { model }))
    .addEdge(START, "planner")
    .addEdge("planner", "executor")
    .addConditionalEdges("executor", routeAfterExecutor, ["executor", "evaluator"])
    .addConditionalEdges("evaluator", routeAfterEvaluator, ["reflector", END])
    .addEdge("reflector", "executor")
    .compile() as unknown as CompiledStateGraph<any, any, any>;
}

export interface RunPlanExecutePipelineOutput extends PipelineStateValue {}

/** 运行跨工单流水线；parentThreadId 用于给每个步骤生成稳定子线程。 */
export async function runPlanExecutePipeline(
  input: string,
  options: {
    model: BaseChatModel;
    parentThreadId?: string;
  },
): Promise<RunPlanExecutePipelineOutput> {
  const parentThreadId = options.parentThreadId?.trim() || `pipeline-${Date.now()}`;
  const graph = createPlanExecutePipeline(options.model);
  return graph.invoke({ input, parentThreadId }, {
    configurable: { thread_id: parentThreadId },
  }) as Promise<RunPlanExecutePipelineOutput>;
}
