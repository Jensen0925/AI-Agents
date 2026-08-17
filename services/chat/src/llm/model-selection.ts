export type ReasoningEffort = "medium" | "high";

/** 与 langchain.yaml 的 llm.modelTiers 对应的模型档位。 */
export type ModelTier = "high" | "medium" | "compressor";

export interface ModelSelectionOptions {
  /**
   * 主分析链默认使用 YAML 中的 high；独立轻量节点可显式传 medium。
   * 项目不再使用 low，以免影响分类、工具选择和业务结论质量。
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * 允许评测或一次性脚本显式覆盖模型，常规业务调用仍使用集中 YAML 配置。
   */
  modelName?: string;
  /**
   * 按档位从 YAML 的 llm.modelTiers 选择模型；未传时使用 llm.model 默认模型。
   */
  tier?: ModelTier;
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
    (options.tier ? llm.modelTiers[options.tier] : llm.model)
  );
}

/** 纯函数：显式选项优先，其次按档位选择推理强度，最后用全局默认值。 */
export function resolveReasoningEffort(
  options: ModelSelectionOptions,
  llm: LlmModelConfig,
): ReasoningEffort {
  return (
    options.reasoningEffort ??
    (options.tier
      ? options.tier === "high"
        ? "high"
        : "medium"
      : llm.reasoningEffort)
  );
}
