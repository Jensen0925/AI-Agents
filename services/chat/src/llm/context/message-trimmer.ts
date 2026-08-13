import type {
  AIMessage,
  BaseMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

export interface TrimOptions {
  maxMessages?: number;
  preserveSystemMessages?: boolean;
}

function toolCallIds(message: AIMessage): string[] {
  return (message.tool_calls ?? [])
    .map((call) => call.id)
    .filter((id): id is string => Boolean(id));
}

function toolCallId(message: ToolMessage): string | undefined {
  return typeof message.tool_call_id === "string"
    ? message.tool_call_id
    : undefined;
}

/**
 * 清理窗口内不完整的 tool call 对。
 * 采用“全有或全无”：一个 AIMessage 的所有 tool call 都有响应时才保留，
 * 同时只保留精确匹配这些 call id 的 ToolMessage。
 */
export function removeOrphanToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const respondedToolCallIds = new Set(
    messages
      .filter((message): message is ToolMessage => message.type === "tool")
      .map(toolCallId)
      .filter((id): id is string => Boolean(id)),
  );
  const survivingToolCallIds = new Set<string>();
  const survivingAiMessages = new Set<BaseMessage>();

  for (const message of messages) {
    if (message.type !== "ai") continue;
    const ids = toolCallIds(message as AIMessage);
    if (ids.length > 0 && ids.every((id) => respondedToolCallIds.has(id))) {
      survivingAiMessages.add(message);
      ids.forEach((id) => survivingToolCallIds.add(id));
    }
  }

  return messages.filter((message) => {
    if (message.type === "tool") {
      const id = toolCallId(message as ToolMessage);
      return Boolean(id && survivingToolCallIds.has(id));
    }
    if (message.type === "ai" && toolCallIds(message as AIMessage).length > 0) {
      return survivingAiMessages.has(message);
    }
    return true;
  });
}

/** 保留系统提示与最近消息，避免历史窗口膨胀。 */
export function trimMessagesForContext(
  messages: BaseMessage[],
  options: TrimOptions = {},
): BaseMessage[] {
  const maxMessages = Math.max(0, options.maxMessages ?? 20);
  const preserveSystemMessages = options.preserveSystemMessages ?? true;
  const systemMessages = preserveSystemMessages
    ? messages.filter((message): message is SystemMessage => message.type === "system")
    : [];
  const nonSystemMessages = preserveSystemMessages
    ? messages.filter((message) => message.type !== "system")
    : messages;
  const recentMessages = nonSystemMessages.slice(-maxMessages);
  return [...systemMessages, ...removeOrphanToolMessages(recentMessages)];
}
