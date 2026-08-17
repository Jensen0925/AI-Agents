/**
 * 兼容两类 OpenAI 兼容网关：
 * - OpenAI 风格：baseURL 形如 https://host/v1，SDK 追加后为 /v1/chat/completions；
 * - DeepSeek 风格：baseURL 形如 https://host，SDK 追加后为 /chat/completions。
 *
 * 这里只清理末尾斜杠和误填的完整 /chat/completions，不再强制拼接 /v1，
 * 这样两种地址格式都能直接用，DeepSeek 网关也不会被打到 /v1/chat/completions。
 */
export function normalizeChatBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }
  return baseURL
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
}
