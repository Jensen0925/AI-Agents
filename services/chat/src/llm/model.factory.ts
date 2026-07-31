import { ChatOpenAI } from "@langchain/openai";
import {
  getApiKeys,
  loadLangchainConfig,
} from "../config/load-langchain-config";

export function createChatModel(): ChatOpenAI {
  const { llm } = loadLangchainConfig();
  // OpenAI 兼容网关的令牌与 baseURL 只能由集中配置函数提供。
  const { apiKey, baseURL } = getApiKeys().openai;

  return new ChatOpenAI({
    model: llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    timeout: llm.timeoutMs,
    maxRetries: llm.maxRetries,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
  });
}
