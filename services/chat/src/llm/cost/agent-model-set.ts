/** 需求分析图中可单独分配模型的节点角色。 */
export type AgentName =
  | "supervisor"
  | "functional_expert"
  | "performance_expert"
  | "security_expert"
  | "compliance_expert"
  | "risk_agent"
  | "summary_agent"
  | "critic"
  | "compressor";

/** 按角色声明默认模型配置 ID，不涉及数据库读取或模型实例化。 */
export interface AgentModelSet {
  supervisorModelConfigId: string;
  functionalModelConfigId: string;
  performanceModelConfigId: string;
  securityModelConfigId: string;
  complianceModelConfigId: string;
  riskModelConfigId: string;
  summaryModelConfigId: string;
  criticModelConfigId: string;
  compressorModelConfigId: string;
}

export const DEFAULT_AGENT_MODEL_SET: AgentModelSet = {
  supervisorModelConfigId: "demo-gpt-5.6-terra",
  functionalModelConfigId: "demo-gpt-5.6-luna",
  performanceModelConfigId: "demo-gpt-5.6-luna",
  securityModelConfigId: "demo-gpt-5.6-terra",
  complianceModelConfigId: "demo-gpt-5.6-terra",
  riskModelConfigId: "demo-gpt-5.6-luna",
  summaryModelConfigId: "demo-gpt-5.6-terra",
  criticModelConfigId: "demo-gpt-5.6-terra",
  compressorModelConfigId: "demo-deepseek-chat",
};

/** 不允许因预算或低复杂度自动降级的高风险角色。 */
export const HIGH_RISK_AGENTS: AgentName[] = [
  "supervisor",
  "security_expert",
  "compliance_expert",
  "critic",
  "summary_agent",
];

export const AGENT_TO_CONFIG_KEY: Record<AgentName, keyof AgentModelSet> = {
  supervisor: "supervisorModelConfigId",
  functional_expert: "functionalModelConfigId",
  performance_expert: "performanceModelConfigId",
  security_expert: "securityModelConfigId",
  compliance_expert: "complianceModelConfigId",
  risk_agent: "riskModelConfigId",
  summary_agent: "summaryModelConfigId",
  critic: "criticModelConfigId",
  compressor: "compressorModelConfigId",
};

export interface ResolveModelForAgentInput {
  agentName: AgentName;
  defaultModelSet?: AgentModelSet;
  requirementComplexity?: "low" | "medium" | "high";
  budgetStatus?: { usedPercent: number };
}

export interface ResolvedAgentModel {
  selectedModelConfigId: string;
  overrideReason: string | null;
}

/**
 * 设计期/运行时共享的纯模型选型策略。
 * 决策顺序刻意固定：预算超限例外 → 预算紧张 → 低复杂度 → 默认值。
 */
export function resolveModelForAgent(
  input: ResolveModelForAgentInput,
): ResolvedAgentModel {
  const modelSet = input.defaultModelSet ?? DEFAULT_AGENT_MODEL_SET;
  const defaultModelConfigId = modelSet[AGENT_TO_CONFIG_KEY[input.agentName]];
  const usedPercent = input.budgetStatus?.usedPercent ?? 0;
  const isHighRisk = HIGH_RISK_AGENTS.includes(input.agentName);

  if (usedPercent >= 100 && input.agentName === "compressor") {
    return { selectedModelConfigId: defaultModelConfigId, overrideReason: null };
  }

  if (usedPercent >= 100) {
    return {
      selectedModelConfigId: defaultModelConfigId,
      overrideReason: "budget_exceeded_reject",
    };
  }

  if (usedPercent >= 80 && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: `budget_tight_downgrade (${usedPercent}%)`,
    };
  }

  if (input.requirementComplexity === "low" && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: "low_complexity_downgrade",
    };
  }

  return { selectedModelConfigId: defaultModelConfigId, overrideReason: null };
}
