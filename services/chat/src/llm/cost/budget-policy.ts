import {
  HIGH_RISK_AGENTS,
  type AgentName,
} from "./agent-model-set";

export type BudgetAction = "allow" | "downgrade" | "reject";

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
