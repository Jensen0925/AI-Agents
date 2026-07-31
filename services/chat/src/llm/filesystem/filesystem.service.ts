import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { Injectable } from "@nestjs/common";
import { createChatModel } from "../model.factory";
import {
  businessTools,
  executeBusinessTool,
} from "../tools/business.tools";

const FILESYSTEM_MAX_ROUNDS = 8;
const FILESYSTEM_SYSTEM_PROMPT = `
你是一名需求分析助手，可以按需查询需求单、读取规范和写入分析制品。

工具路径一律使用 workspace 内的相对路径，不要添加 workspace/ 前缀。
当用户询问需求单时，先使用 query_requirement 获取事实。
当分析需要遵循规范时，使用 read_file 读取相关标准。
仅当用户明确要求生成或保存文件时，才使用 write_file。
不得编造工具没有返回的需求事实或文件内容。
`.trim();

export interface FileToolExecution {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  round: number;
  output: string;
  status: "success" | "error";
}

export interface FilesystemChatResult {
  input: string;
  message: string;
  rounds: number;
  stoppedByLimit: boolean;
  toolExecutions: FileToolExecution[];
}

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
export class FilesystemService {
  private model?: ChatOpenAI;

  private getModel(): ChatOpenAI {
    this.model ??= createChatModel();
    return this.model;
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    await executeBusinessTool("write_file", {
      path: relativePath,
      content,
    });
  }

  async chat(input: string): Promise<FilesystemChatResult> {
    const modelWithTools = this.getModel().bindTools(businessTools);
    const messages: BaseMessage[] = [
      new SystemMessage(FILESYSTEM_SYSTEM_PROMPT),
      new HumanMessage(input),
    ];
    const toolExecutions: FileToolExecution[] = [];
    let finalMessage = "";

    for (let round = 1; round <= FILESYSTEM_MAX_ROUNDS; round += 1) {
      const response = await modelWithTools.invoke(messages);
      const toolCalls = response.tool_calls ?? [];
      messages.push(response);
      finalMessage = contentToText(response.content);

      if (toolCalls.length === 0) {
        return {
          input,
          message: finalMessage,
          rounds: round,
          stoppedByLimit: false,
          toolExecutions,
        };
      }

      for (const [index, toolCall] of toolCalls.entries()) {
        const toolCallId = toolCall.id ?? `file-tool-${round}-${index}`;
        let output: string;
        let status: "success" | "error" = "success";

        try {
          output = toolOutputToText(
            await executeBusinessTool(toolCall.name, toolCall.args),
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
      input,
      message: finalMessage,
      rounds: FILESYSTEM_MAX_ROUNDS,
      stoppedByLimit: true,
      toolExecutions,
    };
  }
}
