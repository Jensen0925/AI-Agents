import {
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

export interface SummaryModel {
  invoke(
    messages: { role: string; content: string }[],
  ): Promise<{ content: string }>;
}

export interface CompressionOptions {
  keepRecent?: number;
  summaryMaxTokens?: number;
}

function textOf(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => (typeof block === "string" ? block : JSON.stringify(block)))
    .join("\n");
}

/** 先由调用方裁剪，再按需把早期对话压缩成一个摘要系统消息。 */
export async function compressConversation(
  messages: BaseMessage[],
  summaryModel: SummaryModel,
  options: CompressionOptions = {},
): Promise<BaseMessage[]> {
  const keepRecent = Math.max(0, options.keepRecent ?? 10);
  const summaryMaxTokens = Math.max(1, options.summaryMaxTokens ?? 500);
  const systemMessages = messages.filter((message) => message.type === "system");
  const nonSystemMessages = messages.filter((message) => message.type !== "system");

  if (nonSystemMessages.length <= keepRecent) return messages;

  const earlyMessages = nonSystemMessages.slice(0, -keepRecent);
  const recentMessages = nonSystemMessages.slice(-keepRecent);
  const summary = await summaryModel.invoke([
    {
      role: "system",
      content: `你是对话摘要助手。请压缩早期需求分析对话，保留需求编号、功能描述、用户意图和已完成的操作。输出不超过 ${summaryMaxTokens} tokens。只返回摘要正文。`,
    },
    {
      role: "user",
      content: earlyMessages
        .map((message) => `${message.type}: ${textOf(message)}`)
        .join("\n"),
    },
  ]);

  const summaryMessage = new SystemMessage(
    `[对话摘要]\n${summary.content.trim()}`,
  );
  return [...systemMessages, summaryMessage, ...recentMessages];
}
