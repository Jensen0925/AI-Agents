import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import {
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { MessageRole, type Prisma } from "@prisma/client";
import { MessageService } from "./message.service";

function contentToText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function messageMetadata(message: BaseMessage): Prisma.InputJsonValue | undefined {
  const metadata = {
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
  };

  try {
    const serialized = JSON.stringify(metadata);
    return serialized ? (JSON.parse(serialized) as Prisma.InputJsonValue) : undefined;
  } catch {
    return undefined;
  }
}

export class DbChatHistory extends BaseListChatMessageHistory {
  lc_namespace = ["cloudsage", "chat", "db-chat-history"];

  constructor(
    private readonly conversationId: string,
    private readonly messageService: MessageService,
  ) {
    super();
  }

  getMessages(): Promise<BaseMessage[]> {
    return this.messageService.getHistoryAsLangChainMessages(
      this.conversationId,
    );
  }

  async addMessage(message: BaseMessage): Promise<void> {
    const type = message.getType();
    const role = type === "human" ? MessageRole.USER : MessageRole.ASSISTANT;
    if (type !== "human" && type !== "ai") {
      throw new Error(`Unsupported persisted message type: ${type}`);
    }

    await this.messageService.addMessage(
      this.conversationId,
      role,
      contentToText(message.content),
      messageMetadata(message),
    );
  }

  async addMessages(messages: BaseMessage[]): Promise<void> {
    // 顺序写入，保证 createdAt 相同的情况下消息顺序仍与模型调用一致。
    for (const message of messages) {
      await this.addMessage(message);
    }
  }

  clear(): Promise<void> {
    return this.messageService.clearHistory(this.conversationId);
  }
}
