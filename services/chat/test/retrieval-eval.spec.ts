import { describe, expect, it, vi } from "vitest";
import type { EmbeddingService } from "../src/llm/embedding/embedding.service";
import {
  DOCUMENT_EMBEDDING_DIMENSION,
  type DocumentEmbeddingService,
} from "../src/document/embedding.service";
import { SearchService } from "../src/document/search.service";
import {
  addOverallMetrics,
  aggregateEvaluation,
  gateDecision,
  type EvaluationCaseDetail,
} from "../rag/evaluation/aggregate";
import {
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from "../rag/evaluation/retrieval-metrics";
import {
  RETRIEVAL_FIXTURE_CHUNKS as CORPUS,
  RETRIEVAL_FIXTURE_QUERIES as QUERIES,
  RETRIEVAL_FIXTURE_TOP_K as TOP_K,
  RETRIEVAL_FIXTURE_USER_ID as EVAL_USER_ID,
} from "../eval/retrieval-fixture";
import { createDatabaseMock, sqlText, sqlValues } from "./drizzle-test-utils";

/**
 * 生产检索路径的离线评测。
 *
 * `scripts/run-eval.ts` 需要 PostgreSQL 与真实 embedding 服务，无法在 CI 中执行。
 * 这里用确定性的内存语料复现 pgvector 的排序语义，把**生产实现**
 * （`SearchService.similaritySearch` 与混合检索 `search`）的真实输出喂给仓库
 * 自带的评测指标与门禁，让 recall/precision/ndcg/mrr 在每次 `pnpm test` 时
 * 都会被真正计算。
 *
 * 语料与 gold 标注来自 `eval/retrieval-fixture.ts`，与需要真实数据库的
 * `scripts/run-retrieval-eval.ts` 共用同一份，避免两边漂移。
 */

/** 通过关键词桶构造确定性向量：同一主题的文本相似度接近 1，跨主题为 0。 */
const TOPIC_KEYWORDS = [
  ["登录", "密码", "失败", "锁定", "账户", "认证"],
  ["退货", "蓝牙", "耳机", "未拆封", "七天"],
  ["支付", "回调", "幂等", "入账", "重复"],
] as const;

function toVector(text: string): number[] {
  const vector = Array.from(
    { length: DOCUMENT_EMBEDDING_DIMENSION },
    () => 0,
  );
  TOPIC_KEYWORDS.forEach((keywords, topic) => {
    vector[topic] = keywords.reduce(
      (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
      0,
    );
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** 期望的 gold 结果（按各 query 的 gold 顺序展开），断言从语料派生而非硬编码。 */
const EXPECTED_DOCUMENT_IDS = QUERIES.flatMap((query) =>
  CORPUS.filter((chunk) => query.relevantChunkIds.includes(chunk.id)).map(
    (chunk) => chunk.documentId,
  ),
);
const EXPECTED_CHUNK_INDEXES = QUERIES.flatMap((query) =>
  CORPUS.filter((chunk) => query.relevantChunkIds.includes(chunk.id)).map(
    (chunk) => chunk.chunkIndex,
  ),
);
const GOLD_ID_SETS = QUERIES.map((query) => [...query.relevantChunkIds].sort());

/**
 * 复现 pgvector 的检索语义：`ORDER BY embedding <=> query LIMIT k`，
 * 分数为 `1 - 余弦距离`。BM25 语料查询（不含 `<=>`）返回全量语料。
 */
function createRetrievalFixture(database: ReturnType<typeof createDatabaseMock>): void {
  const execute = vi.fn(async (query: unknown) => {
    if (sqlText(query).includes('"embedding" <=>')) {
      const values = sqlValues(query);
      const literal = values.find(
        (value): value is string =>
          typeof value === "string" && value.startsWith("["),
      );
      const queryVector = literal
        ? literal.slice(1, -1).split(",").map(Number)
        : [];
      // LIMIT 的绑定参数是本次 SQL 中唯一的数值；不能用 values.at(-1)，
      // 它拿到的是模板尾部的空白字符串（Number("\n  ") === 0，会静默截成空结果）。
      const limit = [...values].reverse().find((value) => typeof value === "number");
      return CORPUS.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score: cosine(queryVector, toVector(chunk.content)),
      }))
        .sort((left, right) => right.score - left.score)
        .slice(0, typeof limit === "number" ? limit : CORPUS.length);
    }
    // BM25 语料：`ORDER BY documentId, chunkIndex`，与生产 SQL 的确定性排序一致。
    return [...CORPUS]
      .sort((left, right) =>
        left.documentId === right.documentId
          ? left.chunkIndex - right.chunkIndex
          : left.documentId.localeCompare(right.documentId),
      )
      .map((chunk) => ({ ...chunk, score: 0 }));
  });
  (database.db.execute as ReturnType<typeof vi.fn>).mockImplementation(execute);
}

/** 检索器按内容确定性出向量，避免依赖本地 Xenova 模型下载。 */
function createSearchService() {
  const embedTexts = vi.fn(async (texts: string[]) => texts.map(toVector));
  const database = createDatabaseMock({
    // 前置存在性检查：该用户名下确实有可检索文档块。
    select: Array.from({ length: 8 }, () => [{ id: "doc-login" }]),
  });
  createRetrievalFixture(database);
  const service = new SearchService(database, {
    embedTexts,
  } as unknown as DocumentEmbeddingService & EmbeddingService);
  return { service, embedTexts };
}

interface CaseOutcome {
  detail: EvaluationCaseDetail;
  retrievedIds: string[];
  retrievedDocumentIds: (string | undefined)[];
  retrievedChunkIndexes: (number | undefined)[];
}

async function evaluateRetrieval(
  retrieve: (query: string) => Promise<
    Array<{
      id?: string;
      documentId?: string;
      chunkIndex?: number;
      content: string;
      score: number;
    }>
  >,
): Promise<CaseOutcome[]> {
  const outcomes: CaseOutcome[] = [];
  for (const query of QUERIES) {
    const retrieved = await retrieve(query.input);
    const retrievedIds = retrieved.flatMap((item) =>
      typeof item.id === "string" ? [item.id] : [],
    );
    outcomes.push({
      retrievedIds,
      retrievedDocumentIds: retrieved.map((item) => item.documentId),
      retrievedChunkIndexes: retrieved.map((item) => item.chunkIndex),
      detail: {
        id: query.id,
        tags: ["retrieval"],
        metrics: {
          recallAtK: recallAtK(retrievedIds, query.relevantChunkIds, TOP_K),
          precisionAtK: precisionAtK(retrievedIds, query.relevantChunkIds, TOP_K),
          ndcgAtK: ndcgAtK(retrievedIds, query.relevantChunkIds, TOP_K),
        },
      },
    });
  }
  return outcomes;
}

/** 与 `scripts/run-eval.ts` 完全一致的聚合方式：per-case 指标 + 数据集级 MRR。 */
function buildSummary(outcomes: CaseOutcome[]) {
  const ranked = outcomes.map((outcome) => outcome.retrievedIds);
  const relevant = QUERIES.map((query) => query.relevantChunkIds);
  return addOverallMetrics(
    aggregateEvaluation(outcomes.map((outcome) => outcome.detail)),
    { mrr: mrr(ranked, relevant) },
  );
}

describe("生产检索路径离线评测：向量检索", () => {
  it("similaritySearch 的召回达到检索门禁，且保留 chunk 身份信息", async () => {
    const { service } = createSearchService();

    const outcomes = await evaluateRetrieval((query) =>
      service.similaritySearch(query, EVAL_USER_ID, TOP_K),
    );

    // 检索质量：每个查询的两个 gold 块都被召回并排在前列。
    for (const outcome of outcomes) {
      expect(outcome.retrievedIds).toHaveLength(TOP_K);
      expect(outcome.detail.metrics.recallAtK).toBe(1);
      expect(outcome.detail.metrics.precisionAtK).toBe(1);
      expect(outcome.detail.metrics.ndcgAtK).toBe(1);
    }

    // 身份信息必须透传：id 是回归 P2-6（documentId 被写死 "unknown"、
    // chunkIndex 退化成结果序号）的关键断言，也是前端来源定位的依据。
    expect(outcomes.flatMap((outcome) => outcome.retrievedDocumentIds)).toEqual(
      EXPECTED_DOCUMENT_IDS,
    );
    expect(
      outcomes.flatMap((outcome) => outcome.retrievedChunkIndexes),
    ).toEqual(EXPECTED_CHUNK_INDEXES);

    const summary = buildSummary(outcomes);
    const gate = gateDecision(summary);
    expect(gate.failures).toEqual([]);
    expect(gate.passed).toBe(true);
    // 门禁必须真的判定过检索指标，而不是把它们当成「本轮没产出」跳过；
    // 指标缺失时 gate 会走过 skipped 分支并仍然 passed，等于一份空报告。
    expect(gate.skipped).not.toContain("recallAtK");
    expect(gate.skipped).not.toContain("precisionAtK");
    expect(gate.skipped).not.toContain("ndcgAtK");
    expect(gate.skipped).not.toContain("mrr");
  });

  it("混合检索 search 走完向量+BM25+RRF+重排后同样达标", async () => {
    const { service, embedTexts } = createSearchService();

    const outcomes = await evaluateRetrieval((query) =>
      service.search(query, EVAL_USER_ID, TOP_K),
    );

    for (const outcome of outcomes) {
      expect(outcome.retrievedIds).toHaveLength(TOP_K);
    }
    // 同分候选的先后由 RRF 融合顺序决定，没有语义；这里断言的是
    // 「只有该主题的两个块穿过 minScore / RRF / 重排进入 Top-K」。
    expect(
      outcomes.map((outcome) => [...outcome.retrievedIds].sort()),
    ).toEqual(GOLD_ID_SETS);
    expect(gateDecision(buildSummary(outcomes)).passed).toBe(true);
    // 重排会一次性把 query + 候选块提交给 embedding 服务。
    expect(embedTexts).toHaveBeenCalled();
  });

  it("检索排序退化时门禁必须判负，证明评测确实在约束生产链路", async () => {
    // 与生产检索同形、但把最不相关的块排到最前：如果评测是橡皮图章，
    // 这种退化会静默通过。
    const degraded = await evaluateRetrieval(async () =>
      [...CORPUS]
        .reverse()
        .slice(0, TOP_K)
        .map((chunk) => ({ ...chunk, score: 0.9 })),
    );

    const gate = gateDecision(buildSummary(degraded));
    expect(gate.passed).toBe(false);
    expect(gate.failures.map((failure) => failure.metric).sort()).toEqual([
      "mrr",
      "ndcgAtK",
      "precisionAtK",
      "recallAtK",
    ]);
  });
});
