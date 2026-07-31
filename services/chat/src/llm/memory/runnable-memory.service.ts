import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  trimMessages,
} from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import {
  RunnableLambda,
  RunnableWithMessageHistory,
  type Runnable,
} from "@langchain/core/runnables";
import { Injectable } from "@nestjs/common";
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

@Injectable()
export class RunnableMemoryService {
  private readonly histories = new Map<
    string,
    InMemoryChatMessageHistory
  >();
  private conversation?: Runnable<MemoryRunnableInput, BaseMessage>;

  private getOrCreateHistory(sessionId: string): InMemoryChatMessageHistory {
    let history = this.histories.get(sessionId);

    if (!history) {
      history = new InMemoryChatMessageHistory();
      this.histories.set(sessionId, history);
    }

    return history;
  }

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
          maxTokens: 2000,//允许的最大总 token，超过就裁剪旧消息
          strategy: "last",//裁剪策略 first：删除最前面的消息（默认，聊天场景最常用）last：删除末尾（极少用）
          tokenCounter: model,
        }),
      }),
    );
    const trimmedConversation = trimHistory.pipe(memoryPrompt).pipe(model);

    this.conversation = new RunnableWithMessageHistory({
      runnable: trimmedConversation,
      getMessageHistory: (sessionId: string) =>
        this.getOrCreateHistory(sessionId),
      inputMessagesKey: "input",
      historyMessagesKey: "history",
    });

    return this.conversation;
  }

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

  async getHistory(sessionId: string): Promise<MemoryHistoryMessage[]> {
    const history = this.histories.get(sessionId);

    if (!history) {
      return [];
    }

    const messages = await history.getMessages();
    return messages.map((message) => ({
      role: message.getType(),
      content: contentToText(message.content),
    }));
  }

  async appendMessage(
    sessionId: string,
    human: string,
    ai: string,
  ): Promise<void> {
    const history = this.getOrCreateHistory(sessionId);
    await history.addMessages([new HumanMessage(human), new AIMessage(ai)]);
  }

  async clearSession(sessionId: string): Promise<void> {
    const history = this.histories.get(sessionId);

    if (history) {
      await history.clear();
      this.histories.delete(sessionId);
    }
  }
}
