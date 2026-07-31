import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Injectable } from "@nestjs/common";
import { loadLangchainConfig } from "../config/load-langchain-config";
import { createChatModel } from "./model.factory";
import { requirementChain } from "./requirement.chain";
import { formatRequirementMessages } from "./requirement.prompt-builder";
import { basicTools, executeBasicTool } from "./tools/basic.tools";

export const LANGCHAIN_USER_INPUT = "用户注册时必须绑定手机号，密码至少8位";

export interface InvokeResult {
  input: string;
  message: string;
}

export interface BatchResult {
  input: string;
  messages: string[];
}

export interface PromptPreviewResult {
  input: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
}

export interface ToolCallSummary {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolBindResult extends InvokeResult {
  toolCalls: ToolCallSummary[];
}

export interface ToolExecution extends ToolCallSummary {
  round: number;
  output: string;
  status: "success" | "error";
}

export interface ToolLoopResult extends InvokeResult {
  rounds: number;
  stoppedByLimit: boolean;
  toolExecutions: ToolExecution[];
}

const TOOL_LOOP_MAX_ROUNDS = 4;
const TOOL_USAGE_INSTRUCTION =
  "请先调用工具校验每条明确约束，并查询关键业务实体定义；获得工具结果后再完成需求抽取。";

// LangChain 的消息内容既可能是纯文本，也可能是结构化内容块。
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

function toolOutputToText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

@Injectable()
export class LlmService {
  private model?: ChatOpenAI;

  private getModel(): ChatOpenAI {
    // 懒加载让健康检查在尚未配置模型密钥时仍可正常工作。
    this.model ??= createChatModel();
    return this.model;
  }

  private createMessages() {
    // 所有调用方式都从同一个 ChatPromptTemplate 格式化消息。
    return formatRequirementMessages(LANGCHAIN_USER_INPUT);
  }

  private async createToolMessages() {
    const messages = await this.createMessages();

    // 明确要求先使用工具，确保示例能展示完整的 tool call 往返过程。
    return [...messages, new HumanMessage(TOOL_USAGE_INSTRUCTION)];
  }

  async invoke(): Promise<InvokeResult> {
    const messages = await this.createMessages();
    const response = await this.getModel().invoke(messages);
    console.log("LangChain invoke response:", response);

    return {
      input: LANGCHAIN_USER_INPUT,
      message: contentToText(response.content),
    };
  }

  async *stream(): AsyncGenerator<string> {
    const { features } = loadLangchainConfig();

    if (!features.streaming) {
      throw new Error("LangChain streaming is disabled");
    }

    const messages = await this.createMessages();
    const responseStream = await this.getModel().stream(messages);

    for await (const chunk of responseStream) {
      const text = contentToText(chunk.content);

      if (text) {
        yield text;
      }
    }
  }

  async batch(): Promise<BatchResult> {
    const { llm, features } = loadLangchainConfig();

    if (!features.batch) {
      throw new Error("LangChain batch calls are disabled");
    }

    const batchSize = Math.max(1, Math.floor(llm.batchSize));
    // batchSize 和 maxConcurrency 都由 YAML 控制，便于按环境调优吞吐。
    const inputs = await Promise.all(
      Array.from({ length: batchSize }, () => this.createMessages()),
    );
    const responses = await this.getModel().batch(inputs, {
      maxConcurrency: llm.maxConcurrency,
    });

    return {
      input: LANGCHAIN_USER_INPUT,
      messages: responses.map((response) => contentToText(response.content)),
    };
  }

  async promptPreview(): Promise<PromptPreviewResult> {
    const messages = await this.createMessages();

    return {
      input: LANGCHAIN_USER_INPUT,
      messages: messages.map((message) => ({
        role: message.getType(),
        content: contentToText(message.content),
      })),
    };
  }

  async promptToModel(): Promise<InvokeResult> {
    // 示例链路：模板变量 -> formatMessages -> 统一模型工厂实例。
    const messages = await formatRequirementMessages(LANGCHAIN_USER_INPUT);
    const response = await this.getModel().invoke(messages);

    return {
      input: LANGCHAIN_USER_INPUT,
      message: contentToText(response.content),
    };
  }

  async chainInvoke(): Promise<InvokeResult> {
    const message = await requirementChain.invoke({
      input: LANGCHAIN_USER_INPUT,
    });

    return {
      input: LANGCHAIN_USER_INPUT,
      message,
    };
  }

  async *chainStream(): AsyncGenerator<string> {
    const { features } = loadLangchainConfig();

    if (!features.streaming) {
      throw new Error("LangChain streaming is disabled");
    }

    const stream = await requirementChain.stream({
      input: LANGCHAIN_USER_INPUT,
    });

    for await (const chunk of stream) {
      if (chunk) {
        yield chunk;
      }
    }
  }

  async chainBatch(): Promise<BatchResult> {
    const { llm, features } = loadLangchainConfig();

    if (!features.batch) {
      throw new Error("LangChain batch calls are disabled");
    }

    const batchSize = Math.max(1, Math.floor(llm.batchSize));
    const inputs = Array.from({ length: batchSize }, () => ({
      input: LANGCHAIN_USER_INPUT,
    }));
    const messages = await requirementChain.batch(inputs, {
      maxConcurrency: llm.maxConcurrency,
    });

    return {
      input: LANGCHAIN_USER_INPUT,
      messages,
    };
  }

  async toolBind(): Promise<ToolBindResult> {
    const messages = await this.createToolMessages();
    const modelWithTools = this.getModel().bindTools(basicTools);
    const response = await modelWithTools.invoke(messages);

    return {
      input: LANGCHAIN_USER_INPUT,
      message: contentToText(response.content),
      toolCalls: (response.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      })),
    };
  }

  async toolLoop(): Promise<ToolLoopResult> {
    const messages = await this.createToolMessages();
    const modelWithTools = this.getModel().bindTools(basicTools);
    const toolExecutions: ToolExecution[] = [];
    let finalMessage = "";

    for (let round = 1; round <= TOOL_LOOP_MAX_ROUNDS; round += 1) {
      const response = await modelWithTools.invoke(messages);
      const toolCalls = response.tool_calls ?? [];
      messages.push(response);
      finalMessage = contentToText(response.content);

      if (toolCalls.length === 0) {
        return {
          input: LANGCHAIN_USER_INPUT,
          message: finalMessage,
          rounds: round,
          stoppedByLimit: false,
          toolExecutions,
        };
      }

      for (const [index, toolCall] of toolCalls.entries()) {
        const toolCallId = toolCall.id ?? `tool-call-${round}-${index}`;
        let output: string;
        let status: "success" | "error" = "success";

        try {
          output = toolOutputToText(
            await executeBasicTool(toolCall.name, toolCall.args),
          );
        } catch (error) {
          status = "error";
          output =
            error instanceof Error ? error.message : "Tool execution failed";
        }

        toolExecutions.push({
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
          round,
          output,
          status,
        });
        // tool_call_id 将工具结果与模型上一条 AIMessage 中的调用一一对应。
        messages.push(
          new ToolMessage({
            content: output,
            tool_call_id: toolCallId,
            name: toolCall.name,
            status,
          }),
        );
      }
    }

    return {
      input: LANGCHAIN_USER_INPUT,
      message: finalMessage,
      rounds: TOOL_LOOP_MAX_ROUNDS,
      stoppedByLimit: true,
      toolExecutions,
    };
  }
}
