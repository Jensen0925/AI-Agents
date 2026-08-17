/**
 * 设计期 Token 与成本估算工具。
 *
 * 该估算器只用于比较 Multi-Agent 链路的相对成本和预算；它不是 provider
 * usage 的精确计费结果。以上价格示例来自 2025-2026 年早期，仅供参考；
 * 上线前请以对应模型厂商官网的最新报价为准。
 */

export interface ModelPricing {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface GraphNodeCostInput {
  nodeName: string;
  modelName: string;
  systemPrompt: string | null | undefined;
  toolSchemas?: unknown;
  messages?: unknown;
  outputText: string | null | undefined;
}

export interface GraphNodeCostEstimate {
  nodeName: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** 示例价格，单位为 USD / 1M tokens；上线前请以厂商官网最新报价为准。 */
export const PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-pro": { input: 2.5, output: 10, cachedInput: 1.25 },
  "claude-sonnet": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-haiku": { input: 0.8, output: 4, cachedInput: 0.08 },
  "deepseek-v4-flash": { input: 0.27, output: 1.1 },
};

const DEFAULT_MODEL = "deepseek-v4-pro";

function stringifyForEstimation(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isChineseCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  );
}

/** 中文字符按 1 token，其余字符按每 4 个约 1 token。 */
export function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0;

  let chineseTokens = 0;
  let otherCharacters = 0;
  for (const character of text) {
    if (isChineseCodePoint(character.codePointAt(0) ?? 0)) {
      chineseTokens += 1;
    } else {
      otherCharacters += 1;
    }
  }
  return chineseTokens + Math.ceil(otherCharacters / 4);
}

/** 获取模型价格；未知模型统一回退到 deepseek-v4-pro。 */
export function getModelPricing(modelName: string): ModelPricing {
  const normalized = modelName.trim().toLowerCase();
  return PRICING[normalized] ?? PRICING[DEFAULT_MODEL];
}

/** 估算单个 LangGraph 节点的一次模型调用成本。 */
export function estimateGraphNodeCost(
  input: GraphNodeCostInput,
): GraphNodeCostEstimate {
  const inputText = [
    input.systemPrompt,
    stringifyForEstimation(input.toolSchemas),
    stringifyForEstimation(input.messages),
  ]
    .filter(Boolean)
    .join("\n\n");
  const inputTokens = estimateTextTokens(inputText);
  const outputTokens = estimateTextTokens(input.outputText);
  const pricing = getModelPricing(input.modelName);

  return {
    nodeName: input.nodeName,
    modelName: input.modelName,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000,
  };
}
