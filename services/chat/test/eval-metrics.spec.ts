import { describe, expect, it } from "vitest";
import {
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from "../rag/evaluation/retrieval-metrics";
import { runRagasEvaluation } from "../rag/evaluation/ragas-runner";

/**
 * 评测工具本身的单元测试：指标计算与 RAGAS 旁路。
 *
 * 生产检索链路的评测在 `test/retrieval-eval.spec.ts`（离线、进 CI）与
 * `scripts/run-retrieval-eval.ts`（真实 pgvector + 真实 embedding）。
 */

describe("检索评测指标", () => {
  it("所有相关文档都位于 Top-K 时 Recall@K 为 1", () => {
    expect(recallAtK(["doc-a", "doc-b", "doc-c"], ["doc-a", "doc-b"], 2)).toBe(
      1,
    );
  });

  it("MRR 在第 1 位命中为 1，在第 2 位命中为 0.5", () => {
    expect(mrr([["doc-a", "doc-b"]], [["doc-a"]])).toBe(1);
    expect(mrr([["doc-a", "doc-b"]], [["doc-b"]])).toBe(0.5);
  });

  it("Precision@K 使用 Top-K 作为分母", () => {
    expect(precisionAtK(["doc-a", "doc-b"], ["doc-a"], 2)).toBe(0.5);
  });

  it("单个相关文档完全命中时 NDCG@K 为 1", () => {
    expect(ndcgAtK(["doc-a", "doc-b"], ["doc-a"], 2)).toBe(1);
  });
});

describe("RAGAS 旁路", () => {
  it("RAGAS 服务不可用时告警并返回 null，不抛错", async () => {
    const warnings: string[] = [];
    const unavailableFetch = (async () => {
      throw new Error("RAGAS offline");
    }) as unknown as typeof fetch;

    const result = await runRagasEvaluation(
      {
        samples: [
          {
            question: "测试问题",
            answer: "测试回答",
            contexts: ["测试上下文"],
            ground_truth: "测试事实",
          },
        ],
        metrics: ["faithfulness"],
      },
      {
        baseUrl: "http://ragas.test",
        retries: 0,
        fetchFn: unavailableFetch,
        warn: (message) => warnings.push(message),
      },
    );

    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RAGAS");
  });
});
