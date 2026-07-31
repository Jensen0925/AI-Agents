import { StringOutputParser } from "@langchain/core/output_parsers";
import { createChatModel } from "../model.factory";
import {
  analysisPrompt,
  clarifyPrompt,
  extractPrompt,
  riskPrompt,
  summaryPrompt,
} from "../prompts/requirement.prompts";

const model = createChatModel();

export const extractAgent = extractPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

export const clarifyAgent = clarifyPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

export const analysisAgent = analysisPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

export const riskAgent = riskPrompt
  .pipe(model)
  .pipe(new StringOutputParser());

export const summaryAgent = summaryPrompt
  .pipe(model)
  .pipe(new StringOutputParser());
