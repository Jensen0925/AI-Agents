import { StringOutputParser } from "@langchain/core/output_parsers";
import { createChatModel } from "./model.factory";
import { requirementPrompt } from "./requirement.prompt-builder";

const model = createChatModel();

export const requirementChain = requirementPrompt
  .pipe(model)
  .pipe(new StringOutputParser());
