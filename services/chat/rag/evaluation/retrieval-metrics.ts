/**
 * 离线检索评测指标。
 *
 * 这些函数以文档/块 ID 的二元相关性为输入，不依赖数据库或模型服务，因此可以
 * 在本地和 CI 中直接执行。
 */

function normalizedRelevantIds(relevantIds: string[]): Set<string> {
  return new Set(relevantIds);
}

function normalizedK(k: number): number {
  return Number.isInteger(k) && k > 0 ? k : 0;
}

/**
 * Recall@K：Top-K 中命中的相关文档数 / 全部相关文档数。
 * 重复返回的同一个文档只计一次，避免重复结果虚高指标。
 */
export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const topK = normalizedK(k);
  const relevant = normalizedRelevantIds(relevantIds);
  if (topK === 0 || relevant.size === 0) {
    return 0;
  }

  const hits = new Set(
    retrievedIds
      .slice(0, topK)
      .filter((id) => relevant.has(id)),
  );
  return hits.size / relevant.size;
}

/**
 * Precision@K：Top-K 中命中的相关块数 / K。实际返回不足 K 条时仍以 K 为分母，
 * 这样空检索或过早截断不会获得虚高分数。
 */
export function precisionAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const topK = normalizedK(k);
  const relevant = normalizedRelevantIds(relevantIds);
  if (topK === 0 || relevant.size === 0) {
    return 0;
  }

  const hits = new Set(
    retrievedIds
      .slice(0, topK)
      .filter((id) => relevant.has(id)),
  );
  return hits.size / topK;
}

/**
 * Mean Reciprocal Rank：每个查询只关注第一个相关结果出现的排名。
 * 没有相关结果的查询按 0 计入平均值。
 */
export function mrr(
  rankedListsPerQuery: string[][],
  relevantPerQuery: string[][],
): number {
  const queryCount = Math.max(
    rankedListsPerQuery.length,
    relevantPerQuery.length,
  );
  if (queryCount === 0) {
    return 0;
  }

  let reciprocalRankSum = 0;
  for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
    const relevant = normalizedRelevantIds(relevantPerQuery[queryIndex] ?? []);
    if (relevant.size === 0) {
      continue;
    }

    const firstRelevantIndex = (rankedListsPerQuery[queryIndex] ?? []).findIndex(
      (id) => relevant.has(id),
    );
    if (firstRelevantIndex >= 0) {
      reciprocalRankSum += 1 / (firstRelevantIndex + 1);
    }
  }

  return reciprocalRankSum / queryCount;
}

/**
 * NDCG@K：二元相关性下的归一化 Discounted Cumulative Gain。
 */
export function ndcgAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  const topK = normalizedK(k);
  const relevant = normalizedRelevantIds(relevantIds);
  if (topK === 0 || relevant.size === 0) {
    return 0;
  }

  let dcg = 0;
  const seen = new Set<string>();
  for (const [index, id] of retrievedIds.slice(0, topK).entries()) {
    if (relevant.has(id) && !seen.has(id)) {
      dcg += 1 / Math.log2(index + 2);
      seen.add(id);
    }
  }

  const idealHits = Math.min(topK, relevant.size);
  let idcg = 0;
  for (let index = 0; index < idealHits; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}
