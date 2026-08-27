export type ReasoningEffort = "medium" | "high";

/** 面向业务路由的三层推理级别。模型档位由环境变量覆盖 YAML 默认值。 */
export type ReasoningLevel = "light" | "standard" | "deep";

/** 与 OPENAI_MODEL_* / langchain.yaml llm.modelTiers 对应的模型档位。 */
export type ModelTier = "high" | "medium" | "compressor";

export interface ModelSelectionOptions {
  /**
   * 主分析链默认使用 high 档；独立轻量节点可显式传 medium。
   * 项目不再使用 low，以免影响分类、工具选择和业务结论质量。
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * 允许评测或一次性脚本显式覆盖模型，常规业务调用使用集中环境配置。
   */
  modelName?: string;
  /**
   * 按档位选择环境配置的模型；未传时使用 OPENAI_MODEL 默认模型。
   */
  tier?: ModelTier;
  /**
   * 业务层已经完成意图/风险判断时，可用三层语义直接选择模型。
   * 映射关系：light→compressor，standard→medium，deep→high。
   */
  reasoningLevel?: ReasoningLevel;
}

export interface LlmModelConfig {
  model: string;
  modelTiers: Record<ModelTier, string>;
  reasoningEffort: ReasoningEffort;
}

/** 纯函数：根据调用选项与集中配置决定最终模型名。 */
export function resolveModelName(
  options: ModelSelectionOptions,
  llm: LlmModelConfig,
): string {
  return (
    options.modelName?.trim() ||
    (options.reasoningLevel
      ? llm.modelTiers[reasoningLevelToTier(options.reasoningLevel)]
      : options.tier
        ? llm.modelTiers[options.tier]
        : llm.model)
  );
}

/** 纯函数：显式选项优先，其次按档位选择推理强度，最后用全局默认值。 */
export function resolveReasoningEffort(
  options: ModelSelectionOptions,
  llm: LlmModelConfig,
): ReasoningEffort {
  return (
    options.reasoningEffort ??
    (options.reasoningLevel
      ? reasoningLevelToEffort(options.reasoningLevel)
      : options.tier
      ? options.tier === "high"
        ? "high"
        : "medium"
      : llm.reasoningEffort)
  );
}

export interface ReasoningDecisionInput {
  intent?: "analyze" | "query" | "chat" | "risk_only";
  input?: string;
  requirementComplexity?: "low" | "medium" | "high";
  riskLevel?: "low" | "medium" | "high";
  hasRequirementId?: boolean;
  isLongChain?: boolean;
}

export interface ReasoningDecision {
  level: ReasoningLevel;
  modelTier: ModelTier;
  reasoningEffort: ReasoningEffort;
  reason: string;
}

function reasoningLevelToTier(level: ReasoningLevel): ModelTier {
  if (level === "light") return "compressor";
  if (level === "standard") return "medium";
  return "high";
}

function reasoningLevelToEffort(level: ReasoningLevel): ReasoningEffort {
  return level === "deep" ? "high" : "medium";
}

/**
 * 纯函数：根据意图、风险和任务复杂度选择三层推理级别。
 * 优先级固定为高风险/深链路 → 轻量意图 → 标准默认，避免“查询风险”被误降级。
 */
export function resolveReasoningDecision(
  input: ReasoningDecisionInput,
): ReasoningDecision {
  const text = input.input?.trim() ?? "";
  const highRiskText =
    /(安全|合规|权限|鉴权|认证|登录|注册|账号|密码|隐私|风控|金融|支付|法律|审计|加密|数据保护)/iu.test(
      text,
    );
  const deep =
    input.riskLevel === "high" ||
    highRiskText ||
    input.requirementComplexity === "high" ||
    input.isLongChain === true ||
    input.intent === "risk_only";

  if (deep) {
    const reason = input.riskLevel === "high" || highRiskText
      ? "高风险或敏感领域需要深度推理"
      : "复杂需求或长链路需要深度推理";
    return {
      level: "deep",
      modelTier: "high",
      reasoningEffort: "high",
      reason,
    };
  }

  if (input.intent === "chat" || input.intent === "query") {
    return {
      level: "light",
      modelTier: "compressor",
      reasoningEffort: "medium",
      reason: input.intent === "chat" ? "普通闲聊使用轻量模型" : "状态查询使用轻量模型",
    };
  }

  if (input.requirementComplexity === "low") {
    return {
      level: "light",
      modelTier: "compressor",
      reasoningEffort: "medium",
      reason: "低复杂度需求使用轻量模型",
    };
  }

  return {
    level: "standard",
    modelTier: "medium",
    reasoningEffort: "medium",
    reason: "普通需求使用标准推理",
  };
}
