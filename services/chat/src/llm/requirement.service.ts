import {
  RequirementResultSchema,
  type RequirementResult,
} from "@cloudsage/contracts";
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

/** 使用共享 Prompt 与 Schema 将自然语言需求抽取为固定字段结构。 */
@Injectable()
export class RequirementService {
  private model?: ChatOpenAI;

  /** 首次抽取时创建模型，后续调用复用同一实例。 */
  private getModel(): ChatOpenAI {
    // 首次抽取时才读取模型密钥，避免其他 Nest 路由被模型配置阻塞。
    this.model ??= createChatModel();
    return this.model;
  }

  /**
   * 渲染需求抽取消息，并通过 withStructuredOutput 校验模型返回结构。
   */
  async extract(input: string): Promise<RequirementResult> {
    const messages = await prompt.formatMessages({ input });
    const structuredModel = this.getModel().withStructuredOutput(
      RequirementResultSchema,
    );

    return structuredModel.invoke(messages);
  }
}
