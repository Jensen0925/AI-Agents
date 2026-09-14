import {
  HIGH_RISK_AGENTS,
  type AgentName,
} from "./agent-model-set";

export type BudgetAction = "allow" | "downgrade" | "reject";

/**
 * 未配置 `MONTHLY_BUDGET_USD` 时的兜底月度预算（USD）。
 *
 * 历史实现把缺失的预算读成 0 并以此短路整个预算检查，等价于「默认部署下
 * 模型成本没有任何上限」——一次跑飞的循环就能烧掉任意金额。这里给一个明确的
 * 安全网额度：行为上仍然只在 80%/100% 时降级与熔断，但至少存在上限。
 * 需要真正不限额（自托管、压测）时显式设置 `MONTHLY_BUDGET_USD=0`。
 */
export const DEFAULT_MONTHLY_BUDGET_USD = 100;

/**
 * 解析月度预算上限。
 * - 未设置 / 空串 / 非法数字 → `DEFAULT_MONTHLY_BUDGET_USD`
 * - `0` 或负数 → 0，表示显式关闭预算熔断
 */
export function resolveMonthlyBudgetUsd(
  raw: string | undefined = process.env["MONTHLY_BUDGET_USD"],
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MONTHLY_BUDGET_USD;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MONTHLY_BUDGET_USD;
  }

  return parsed;
}

export interface BudgetPolicyInput {
  budgetUsedPercent: number;
  agentName: string;
  requirementRiskLevel?: "low" | "medium" | "high";
}

export interface BudgetPolicyResult {
  action: BudgetAction;
  reason: string;
}

/**
 * 在执行节点前评估预算动作。它只决定是否执行或是否允许降级，
 * 不承担模型选择职责；具体模型由 resolveModelForAgent 解析。
 */
export function resolveBudgetAction(
  input: BudgetPolicyInput,
): BudgetPolicyResult {
  const { budgetUsedPercent, agentName } = input;

  if (budgetUsedPercent < 80) {
    return {
      action: "allow",
      reason: `budget OK (${budgetUsedPercent}%)`,
    };
  }

  if (budgetUsedPercent < 100) {
    if (HIGH_RISK_AGENTS.includes(agentName as AgentName)) {
      return {
        action: "allow",
        reason: `high-risk agent, no downgrade (${budgetUsedPercent}%)`,
      };
    }
    return {
      action: "downgrade",
      reason: `budget tight, low-risk agent can downgrade (${budgetUsedPercent}%)`,
    };
  }

  if (agentName === "compressor") {
    return {
      action: "allow",
      reason: "compressor allowed even over budget (cost reduction purpose)",
    };
  }

  return {
    action: "reject",
    reason: `budget exceeded (${budgetUsedPercent}%)`,
  };
}
