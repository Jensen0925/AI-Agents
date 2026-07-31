import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from "./prompts/requirement.prompt";

// 单一模板实例供预览、普通调用、流式调用和批量调用共同复用。
export const requirementPrompt = ChatPromptTemplate.fromMessages([
  ["system", REQUIREMENT_SYSTEM_PROMPT],
  ["human", REQUIREMENT_USER_TEMPLATE],
]);

export const REQUIREMENT_PROMPT_TEMPLATE = requirementPrompt;

export function formatRequirementMessages(input: string) {
  return requirementPrompt.formatMessages({ input });
}
