import {
  type BaseMessage,
  trimMessages,
} from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import {
  RunnableLambda,
  RunnableWithMessageHistory,
  type Runnable,
} from "@langchain/core/runnables";
import { Injectable } from "@nestjs/common";
import { MessageRole } from "@prisma/client";
import { DbChatHistory } from "../../message/db-chat-history";
import { MessageService } from "../../message/message.service";
import { createChatModel } from "../model.factory";

const MEMORY_SYSTEM_PROMPT = `
你是一名需求分析助手。

请结合当前输入和历史对话分析需求，主动延续会话中已经确认的信息。
回答时保持简洁、准确；如果判断需求完整性，需要指出已知信息和仍缺少的信息。
不要编造历史对话中没有出现的需求事实。
`.trim();

interface MemoryRunnableInput {
  input: string;
  history?: BaseMessage[];
}

export interface MemoryHistoryMessage {
  role: string;
  content: string;
}

export interface MemoryChatResult {
  sessionId: string;
  message: string;
  history: MemoryHistoryMessage[];
}

const memoryPrompt = ChatPromptTemplate.fromMessages([
  ["system", MEMORY_SYSTEM_PROMPT],
  new MessagesPlaceholder({ variableName: "history", optional: true }),
  ["human", "{input}"],
]);

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }

      return "";
    })
    .join("");
}

/**
 * 使用 RunnableWithMessageHistory 将需求分析模型接入 PostgreSQL 会话历史。
 * 对外沿用 sessionId 命名，数据库中该值对应 conversationId。
 */
@Injectable()
export class RunnableMemoryService {
  private conversation?: Runnable<MemoryRunnableInput, BaseMessage>;

  constructor(private readonly messageService: MessageService) {}

  /**
   * 懒加载带历史记录的 Runnable，并在每次模型调用前保留最近 2000 tokens。
   * DbChatHistory 负责将 Runnable 的消息读写映射到 messages 表。
   */
  private getConversation(): Runnable<MemoryRunnableInput, BaseMessage> {
    if (this.conversation) {
      return this.conversation;
    }

    // 模型延迟创建，使历史查询和清理不依赖模型凭据。
    const model = createChatModel();
    const trimHistory = RunnableLambda.from(
      async (values: MemoryRunnableInput): Promise<MemoryRunnableInput> => ({
        ...values,
        history: await trimMessages(values.history ?? [], {
          maxTokens: 2000,
          strategy: "last",
          tokenCounter: model,
        }),
      }),
    );
    const trimmedConversation = trimHistory.pipe(memoryPrompt).pipe(model);

    this.conversation = new RunnableWithMessageHistory({
      runnable: trimmedConversation,
      getMessageHistory: (sessionId: string) =>
        new DbChatHistory(sessionId, this.messageService),
      inputMessagesKey: "input",
      historyMessagesKey: "history",
    });

    return this.conversation;
  }

  /** 在指定会话中执行一轮对话，并返回模型结果及更新后的完整历史。 */
  async chat(sessionId: string, input: string): Promise<MemoryChatResult> {
    const response = await this.getConversation().invoke(
      { input },
      { configurable: { sessionId } },
    );

    return {
      sessionId,
      message: contentToText(response.content),
      history: await this.getHistory(sessionId),
    };
  }

  /** 读取指定会话历史，并转换为前端使用的 human/ai 角色。 */
  async getHistory(sessionId: string): Promise<MemoryHistoryMessage[]> {
    const messages = await this.messageService.getHistory(sessionId);
    return messages.map((message) => ({
      role: message.role === MessageRole.USER ? "human" : "ai",
      content: message.content,
    }));
  }

  /**
   * 直接追加一组用户和助手消息，不调用模型。
   * 适用于保存其他分析流程已经生成的最终结论。
   */
  async appendMessage(
    sessionId: string,
    human: string,
    ai: string,
  ): Promise<void> {
    await this.messageService.addMessage(
      sessionId,
      MessageRole.USER,
      human,
    );
    await this.messageService.addMessage(
      sessionId,
      MessageRole.ASSISTANT,
      ai,
    );
  }

  /** 清空指定会话的持久化消息，但不删除会话记录。 */
  async clearSession(sessionId: string): Promise<void> {
    await this.messageService.clearHistory(sessionId);
  }
}
