import { StringOutputParser } from "@langchain/core/output_parsers";
import { lazyRunnable } from "./lazy-runnable";
import { createChatModel } from "./model.factory";
import { requirementPrompt } from "./requirement.prompt-builder";

/**
 * 需求抽取链：prompt → 模型 → 文本解析。
 *
 * 通过 lazyRunnable 惰性构造，避免在模块导入阶段就读取 OPENAI_API_KEY：
 * 缺少环境变量时应用与测试都应能正常导入，只在真正调用时报错。
 */
export const requirementChain = lazyRunnable(() =>
  requirementPrompt.pipe(createChatModel()).pipe(new StringOutputParser()),
);
