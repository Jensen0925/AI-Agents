import { tool, type StructuredTool } from "@langchain/core/tools";
import {
  resolveBudgetAction,
  type BudgetPolicyResult,
} from "../../src/llm/cost/budget-policy";
import { z } from "zod";

export interface RagAskInput {
  question: string;
  topK?: number;
}

/** ragAsk 的最小返回协议；citations 可按具体 RAG pipeline 扩展。 */
export interface RagAskResult {
  answer: string;
  citations: unknown[];
  [key: string]: unknown;
}

export interface CreateRagToolDependencies {
  /** 第 11.6 节的 RAG pipeline 入口，由组合层注入。 */
  ragAsk: (input: RagAskInput) => Promise<RagAskResult>;
  /** 当前月度预算使用比例；可传函数以便每次调用前读取最新值。 */
  budgetUsedPercent: number | (() => number | Promise<number>);
  /** 用于测试或替换预算策略，生产环境默认使用第 10.9 节策略。 */
  resolveBudgetAction?: (input: {
    budgetUsedPercent: number;
    agentName: string;
  }) => BudgetPolicyResult;
}

export const RAG_TOOL_DESCRIPTION = `
从当前用户已授权的知识库文档中检索证据并回答问题。

适用：用户询问已上传资料中的具体政策、产品规则、技术文档、需求说明，且回答需要引用知识库证据时调用。
不适用：普通闲聊、问候、创作、没有依赖知识库事实的通用问答，或需要执行写入/删除等外部操作时不要调用。

调用前请确保问题具体明确；若检索结果不足，应明确说明资料库中没有足够证据，而不是编造答案。
`;

const ragToolSchema = z.object({
  question: z.string().min(1).describe("需要从知识库检索并回答的具体问题"),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("最多检索的相关片段数，默认由 RAG pipeline 决定"),
});

async function resolveCurrentBudget(
  budgetUsedPercent: CreateRagToolDependencies["budgetUsedPercent"],
): Promise<number> {
  return typeof budgetUsedPercent === "function"
    ? await budgetUsedPercent()
    : budgetUsedPercent;
}

/**
 * 将 RAG pipeline 包装为 Functional Expert 可调用的 LangChain StructuredTool。
 *
 * 预算检查必须发生在 ragAsk 前：被拒绝时直接返回 JSON 字符串，不下载模型、不检索
 * 向量库，也不触发后续生成开销。
 */
export function createRagTool(
  deps: CreateRagToolDependencies,
): StructuredTool {
  const decideBudget = deps.resolveBudgetAction ?? resolveBudgetAction;

  return tool(
    async ({ question, topK }) => {
      const budgetUsedPercent = await resolveCurrentBudget(deps.budgetUsedPercent);
      const budgetDecision = decideBudget({
        budgetUsedPercent,
        agentName: "functional_expert",
      });

      if (budgetDecision.action === "reject") {
        return JSON.stringify({ error: "budget_exceeded" });
      }

      const result = await deps.ragAsk({ question, topK });
      return JSON.stringify(result);
    },
    {
      name: "search_knowledge_base",
      description: RAG_TOOL_DESCRIPTION,
      schema: ragToolSchema,
    },
  );
}
