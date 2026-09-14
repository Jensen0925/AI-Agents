import { describe, expect, it } from "vitest";
import {
  aggregateEvaluation,
  gateDecision,
} from "../rag/evaluation/aggregate";

describe("统一评测聚合与门禁", () => {
  it("按全量和 tag 聚合已产出的指标", () => {
    const summary = aggregateEvaluation([
      {
        id: "a",
        tags: ["security"],
        metrics: { recallAtK: 1, intentCorrect: true },
      },
      {
        id: "b",
        tags: ["security", "query"],
        metrics: { recallAtK: 0.5, intentCorrect: false },
      },
    ]);

    expect(summary.overall.metrics.recallAtK).toEqual({ average: 0.75, count: 2 });
    expect(summary.byTag.security.metrics.intentAccuracy).toEqual({ average: 0.5, count: 2 });
    expect(summary.byTag.query.caseCount).toBe(1);
  });

  it("缺失 LLM 维度时跳过对应 gate，不影响 retrieval-only 通过", () => {
    const summary = aggregateEvaluation([
      { id: "a", tags: [], metrics: { recallAtK: 0.9 } },
    ]);
    const decision = gateDecision(summary, {
      recallAtK: 0.8,
      intentAccuracy: 0.9,
      judgePassRate: 0.8,
    });

    expect(decision.passed).toBe(true);
    expect(decision.skipped).toEqual(["intentAccuracy", "judgePassRate"]);
  });

  it("已产出但低于门槛的指标会让 gate 失败", () => {
    const summary = aggregateEvaluation([
      { id: "a", tags: [], metrics: { precisionAtK: 0.2 } },
    ]);
    const decision = gateDecision(summary, { precisionAtK: 0.4 });

    expect(decision.passed).toBe(false);
    expect(decision.failures[0]).toEqual({
      metric: "precisionAtK",
      actual: 0.2,
      threshold: 0.4,
    });
  });

  it("声明为必需的维度若完全没产出，gate 必须失败而不是静默跳过", () => {
    // 复现真实故障：数据集里没有任何 gold chunk id 时，四个检索维度全部缺失，
    // 默认行为是全部 skipped + passed=true —— 一份什么都没测的绿色报告。
    const emptySummary = aggregateEvaluation([
      { id: "a", tags: [], metrics: {} },
    ]);

    const withoutRequirement = gateDecision(emptySummary, { recallAtK: 0.7 });
    expect(withoutRequirement.passed).toBe(true);
    expect(withoutRequirement.skipped).toEqual(["recallAtK"]);

    const withRequirement = gateDecision(emptySummary, { recallAtK: 0.7 }, {
      required: ["recallAtK"],
    });
    expect(withRequirement.passed).toBe(false);
    expect(withRequirement.missing).toEqual(["recallAtK"]);
    expect(withRequirement.skipped).toEqual([]);
  });

  it("必需维度已产出时仍按门槛正常判定", () => {
    const summary = aggregateEvaluation([
      { id: "a", tags: [], metrics: { recallAtK: 0.9 } },
    ]);

    expect(
      gateDecision(summary, { recallAtK: 0.7 }, { required: ["recallAtK"] }).passed,
    ).toBe(true);
    expect(
      gateDecision(summary, { recallAtK: 0.95 }, { required: ["recallAtK"] })
        .passed,
    ).toBe(false);
  });
});
