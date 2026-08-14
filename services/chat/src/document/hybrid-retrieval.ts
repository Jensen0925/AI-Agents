/**
 * 轻量混合检索算法：BM25 关键词召回 + RRF 融合 + embedding 余弦重排。
 *
 * 这是纯函数模块，不依赖数据库或具体 embedding provider；SearchService
 * 可以把自己的召回函数注入进来。这样评测和离线实验不会绕过真实检索链路。
 */

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export type RetrieveFn = (query: string) => Promise<RetrievalResult[]>;

export function tokenize(text: string): string[] {
  if (!text) return [];
  const latin = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  return [...latin, ...cjk];
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export function bm25Search(
  query: string,
  corpus: RetrievalResult[],
  topK = 5,
): RetrievalResult[] {
  if (corpus.length === 0 || topK <= 0) return [];
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const docTokens = corpus.map((doc) => tokenize(doc.content));
  const docLengths = docTokens.map((tokens) => tokens.length);
  const averageLength =
    docLengths.reduce((sum, length) => sum + length, 0) / corpus.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      docTokens.reduce((count, tokens) => count + (tokens.includes(term) ? 1 : 0), 0),
    );
  }

  return corpus
    .map((doc, index) => {
      const frequencies = new Map<string, number>();
      for (const token of docTokens[index]) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      let score = 0;
      for (const term of queryTerms) {
        const termFrequency = frequencies.get(term) ?? 0;
        if (termFrequency === 0) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (corpus.length - df + 0.5) / (df + 0.5));
        const denominator =
          termFrequency +
          BM25_K1 *
            (1 - BM25_B + (BM25_B * docLengths[index]) / averageLength);
        score +=
          idf *
          ((termFrequency * (BM25_K1 + 1)) / denominator);
      }
      return { ...doc, score };
    })
    .filter((doc) => doc.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function reciprocalRankFusion(
  rankedLists: Array<Array<{ id: string }>>,
  offset = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((item, index) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (offset + index + 1));
    });
  }
  return scores;
}

export async function hybridSearch(
  query: string,
  vectorSearch: RetrieveFn,
  keywordSearch: RetrieveFn,
  topK = 5,
): Promise<RetrievalResult[]> {
  if (topK <= 0) return [];
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query),
    keywordSearch(query),
  ]);
  const scores = reciprocalRankFusion([
    vectorResults.map((item) => ({ id: item.chunkId })),
    keywordResults.map((item) => ({ id: item.chunkId })),
  ]);
  const unique = new Map<string, RetrievalResult>();
  for (const item of [...vectorResults, ...keywordResults]) {
    if (!unique.has(item.chunkId)) unique.set(item.chunkId, item);
  }
  return [...unique.values()]
    .map((item) => ({ ...item, score: scores.get(item.chunkId) ?? 0 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function embeddingRerank(
  query: string,
  candidates: RetrievalResult[],
  embed: (texts: string[]) => Promise<number[][]>,
  topK = 5,
): Promise<RetrievalResult[]> {
  if (candidates.length === 0 || topK <= 0) return [];
  const vectors = await embed([query, ...candidates.map((item) => item.content)]);
  const queryVector = vectors[0];
  if (!queryVector?.length) return candidates.slice(0, topK);
  return candidates
    .map((item, index) => ({
      ...item,
      score: cosineSimilarity(queryVector, vectors[index + 1] ?? []),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
