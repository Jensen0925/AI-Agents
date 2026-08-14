/**
 * 将真实检索结果转换为需求分析图使用的上下文格式。
 * 本地 runner 与 LangSmith experiment 共用此函数，避免两套评测链路给模型
 * 传入不同的检索上下文。
 */
export function formatRetrievedContext(
  results: Array<{ id?: string; content: string; score: number }>,
): string {
  if (results.length === 0) {
    return "当前评测用户知识库没有检索到相关文档。";
  }

  return results
    .map(
      (result, index) =>
        `[chunkId:${result.id ?? `unknown-${index + 1}`}, 相关性:${result.score.toFixed(4)}]\n${result.content}`,
    )
    .join("\n\n---\n\n");
}
