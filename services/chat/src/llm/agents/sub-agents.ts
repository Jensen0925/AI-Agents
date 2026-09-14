import { StringOutputParser } from "@langchain/core/output_parsers";
import { lazyRunnable } from "../lazy-runnable";
import { createChatModel } from "../model.factory";
import {
  analysisPrompt,
  clarifyPrompt,
  extractPrompt,
  riskPrompt,
  summaryPrompt,
} from "../prompts/requirement.prompts";

/**
 * 需求分析子链集合。
 *
 * 每个链都通过 lazyRunnable 惰性构造：避免在导入阶段就读取 OPENAI_API_KEY，
 * 并让每个链各自持有一个模型实例，而不是共享在导入期固化的同一个可变实例。
 */
export const extractAgent = lazyRunnable(() =>
  extractPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);

export const clarifyAgent = lazyRunnable(() =>
  clarifyPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);

export const analysisAgent = lazyRunnable(() =>
  analysisPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);

export const riskAgent = lazyRunnable(() =>
  riskPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);

export const summaryAgent = lazyRunnable(() =>
  summaryPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);
