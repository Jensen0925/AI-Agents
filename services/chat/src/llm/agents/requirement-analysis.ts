import {
  createAnalysisGraph,
  runAnalysisGraph,
} from "../graph/requirement-analysis-graph";

/**
 * 第六章原有入口的兼容层。
 * 具体的五 Agent 调用顺序已迁移到 LangGraph，此处只保留原入口返回 summary。
 */
export async function runRequirementAnalysis(input: string): Promise<string> {
  const result = await runAnalysisGraph(input);
  return result.summary;
}

export const requirementAnalysis = runRequirementAnalysis;
export { createAnalysisGraph, runAnalysisGraph };
export default runRequirementAnalysis;
