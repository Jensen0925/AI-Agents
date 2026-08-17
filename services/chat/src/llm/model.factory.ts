import { ChatOpenAI } from "@langchain/openai";
import {
  getApiKeys,
  loadLangchainConfig,
} from "../config/load-langchain-config";
import {
  resolveModelName,
  resolveReasoningEffort,
  type ModelSelectionOptions,
} from "./model-selection";
import { normalizeChatBaseURL } from "./normalize-base-url";

export type { ModelTier, ReasoningEffort } from "./model-selection";

/** 创建聊天模型时的调用选项；兼容旧调用方，只保留显式覆盖能力。 */
export type CreateChatModelOptions = ModelSelectionOptions;

/** 兼容 OpenAI 风格 /v1 与 DeepSeek 风格 /chat/completions，只做基础清理。 */
function normalizeOpenAIBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  return normalizeChatBaseURL(baseURL);
}

export function createChatModel(
  options: CreateChatModelOptions = {},
): ChatOpenAI {
  const { llm } = loadLangchainConfig();
  const model = resolveModelName(options, llm);
  const reasoningEffort = resolveReasoningEffort(options, llm);
  // OpenAI 兼容网关的令牌与 baseURL 只能由集中配置函数提供。
  const { apiKey, baseURL } = getApiKeys().openai;

  return new ChatOpenAI({
    model,
    // 当前 SDK 版本仅把 reasoningEffort 暴露为调用级选项；通过 modelKwargs
    // 透传 OpenAI 兼容参数，避免每一个 invoke 都重复传递。
    modelKwargs: {
      reasoning_effort: reasoningEffort,
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
