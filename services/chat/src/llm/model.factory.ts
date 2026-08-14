import { ChatOpenAI } from "@langchain/openai";
import {
  getApiKeys,
  loadLangchainConfig,
} from "../config/load-langchain-config";

export type ReasoningEffort = "medium" | "high";

export interface CreateChatModelOptions {
  /**
   * 主分析链默认使用 YAML 中的 high；独立轻量节点可显式传 medium。
   * 项目不再使用 low，以免影响分类、工具选择和业务结论质量。
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * 允许评测或一次性脚本显式覆盖模型，常规业务调用仍使用集中 YAML 配置。
   */
  modelName?: string;
}

/** OpenAI SDK 的 baseURL 必须指向 API 根路径，而不是站点根地址。 */
function normalizeOpenAIBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  const normalized = baseURL.replace(/\/+$/, "");
  return /\/v\d+$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

export function createChatModel(
  options: CreateChatModelOptions = {},
): ChatOpenAI {
  const { llm } = loadLangchainConfig();
  // OpenAI 兼容网关的令牌与 baseURL 只能由集中配置函数提供。
  const { apiKey, baseURL } = getApiKeys().openai;

  return new ChatOpenAI({
    model: options.modelName?.trim() || llm.model,
    // 当前 SDK 版本仅把 reasoningEffort 暴露为调用级选项；通过 modelKwargs
    // 透传 OpenAI 兼容参数，避免每一个 invoke 都重复传递。
    modelKwargs: {
      reasoning_effort: options.reasoningEffort ?? llm.reasoningEffort,
    },
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    timeout: llm.timeoutMs,
    maxRetries: llm.maxRetries,
    apiKey,
    configuration: baseURL
      ? { baseURL: normalizeOpenAIBaseURL(baseURL) }
      : undefined,
  });
}
