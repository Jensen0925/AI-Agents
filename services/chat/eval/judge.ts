import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { RequirementAnalysisEvalCase } from "./dataset-loader";

const reportJudgeSchema = z.object({
  passed: z.boolean().describe("报告是否满足需求分析的基本完整性和一致性要求"),
  score: z.number().min(0).max(1).describe("报告质量评分，0 到 1"),
  reasoning: z.string().describe("简明、可审计的判定理由"),
});

export interface ReportJudgeResult {
  passed: boolean;
  score: number;
  reasoning: string;
}

/**
 * 真实 LLM-as-a-judge：仅评估生成报告，不参与检索指标计算。
 * 使用结构化输出把评测结果限定在稳定、可聚合的协议内。
 */
export async function judgeReport(
  model: BaseChatModel,
  testCase: RequirementAnalysisEvalCase,
  summary: string,
): Promise<ReportJudgeResult> {
  const judge = model.withStructuredOutput(reportJudgeSchema);
  return judge.invoke([
    new SystemMessage(`你是严格但不过度苛刻的需求分析报告评审员。

请依据用户原始输入，评估报告是否：
1. 正确理解了用户意图；
2. 给出了可执行的功能/验收/风险或澄清结论；
3. 不捏造与给定事实明显矛盾的内容；
4. 结构清晰，结论对实际需求分析有帮助。

若提供人工事实基准，仅用它核对事实一致性；不要因为报告未逐字复述而扣分。`),
    new HumanMessage(`原始输入：\n${testCase.input}\n\n人工事实基准：\n${testCase.groundTruth ?? "（未提供）"}\n\n待评审报告：\n${summary}`),
  ]);
}
