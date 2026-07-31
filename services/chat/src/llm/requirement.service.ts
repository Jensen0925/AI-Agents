import {
  RequirementResultSchema,
  type RequirementResult,
} from "@autix/contracts";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { ChatOpenAI } from "@langchain/openai";
import { Injectable } from "@nestjs/common";
import { createChatModel } from "./model.factory";
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from "./prompts/requirement.prompt";

const prompt = ChatPromptTemplate.fromMessages([
  ["system", REQUIREMENT_SYSTEM_PROMPT],
  ["human", REQUIREMENT_USER_TEMPLATE],
]);

@Injectable()
export class RequirementService {
  private model?: ChatOpenAI;

  private getModel(): ChatOpenAI {
    // 首次抽取时才读取模型密钥，避免其他 Nest 路由被模型配置阻塞。
    this.model ??= createChatModel();
    return this.model;
  }

  async extract(input: string): Promise<RequirementResult> {
    const messages = await prompt.formatMessages({ input });
    const structuredModel = this.getModel().withStructuredOutput(
      RequirementResultSchema,
    );

    return structuredModel.invoke(messages);
  }
}
