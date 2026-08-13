import { estimateTextTokens, getModelPricing } from "./token-estimator";
import type { TokenUsageService } from "./token-usage.service";

export interface WithTokenUsageOptions {
  graphName: string;
  nodeName: string;
  agentName: string;
  modelName: string;
  modelConfigId?: string | null;
  provider?: string;
  conversationId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  overrideReason?: string | null;
}

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cache_read_input_tokens?: number;
  cachedInputTokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_token_details?: { cache_read?: number; cached_tokens?: number };
  inputTokenDetails?: { cache_read?: number; cached_tokens?: number };
}

interface ModelResultLike {
  content?: unknown;
  text?: unknown;
  response_metadata?: { usage?: UsageLike };
  usage_metadata?: UsageLike;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function extractUsage(result: unknown): UsageLike | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as ModelResultLike;
  return value.response_metadata?.usage ?? value.usage_metadata;
}

function outputTextFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const value = result as ModelResultLike;
  const output = value.content ?? value.text ?? "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(output);
}

/**
 * 在模型调用外侧采集节点级 usage。采集、计价或持久化失败均不会阻塞模型结果。
 */
export async function withTokenUsage<T>(
  options: WithTokenUsageOptions,
  usageService: TokenUsageService | null,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;

  if (!usageService) return result;

  try {
    const usage = extractUsage(result);
    let inputTokens: number;
    let outputTokens: number;
    let totalTokens: number;
    let cachedInputTokens: number;
    let isEstimated = false;

    if (usage) {
      inputTokens =
        asNonNegativeNumber(usage.prompt_tokens) ??
        asNonNegativeNumber(usage.input_tokens) ??
        asNonNegativeNumber(usage.inputTokens) ??
        0;
      outputTokens =
        asNonNegativeNumber(usage.completion_tokens) ??
        asNonNegativeNumber(usage.output_tokens) ??
        asNonNegativeNumber(usage.outputTokens) ??
        0;
      cachedInputTokens =
        asNonNegativeNumber(usage.prompt_tokens_details?.cached_tokens) ??
        asNonNegativeNumber(usage.cache_read_input_tokens) ??
        asNonNegativeNumber(usage.cachedInputTokens) ??
        asNonNegativeNumber(usage.input_token_details?.cache_read) ??
        asNonNegativeNumber(usage.input_token_details?.cached_tokens) ??
        asNonNegativeNumber(usage.inputTokenDetails?.cache_read) ??
        asNonNegativeNumber(usage.inputTokenDetails?.cached_tokens) ??
        0;
      totalTokens =
        asNonNegativeNumber(usage.total_tokens) ??
        asNonNegativeNumber(usage.totalTokens) ??
        inputTokens + outputTokens;
    } else {
      outputTokens = estimateTextTokens(outputTextFromResult(result));
      // 10.2 的真实样本输入/输出约为 5.8:1，这里保守圆整为 5 倍；
      // provider 提供真实 usage 时应始终优先使用真实值。
      inputTokens = outputTokens * 5;
      totalTokens = inputTokens + outputTokens;
      cachedInputTokens = 0;
      isEstimated = true;
    }

    const pricing = getModelPricing(options.modelName);
    const discountedCachedTokens = Math.min(cachedInputTokens, inputTokens);
    const regularInputTokens = Math.max(0, inputTokens - discountedCachedTokens);
    const estimatedCostUsd =
      (regularInputTokens * pricing.input +
        discountedCachedTokens * (pricing.cachedInput ?? pricing.input) +
        outputTokens * pricing.output) /
      1_000_000;

    await usageService.recordUsage({
      ...options,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      estimatedCostUsd,
      isEstimated,
      latencyMs,
    });
  } catch (error) {
    console.warn("[TokenUsage] usage 采集失败，已返回原模型响应", error);
  }

  return result;
}
