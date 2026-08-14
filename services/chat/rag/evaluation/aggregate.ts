export interface CaseEvaluationMetrics {
  recallAtK?: number;
  precisionAtK?: number;
  ndcgAtK?: number;
  /** MRR 属于跨查询聚合指标，runner 将其写入 overall 而非重复写入每个 case。 */
  intentCorrect?: boolean;
  judgePassed?: boolean;
  judgeScore?: number;
  faithfulness?: number;
}

export interface EvaluationCaseDetail {
  id: string;
  tags: string[];
  metrics: CaseEvaluationMetrics;
  error?: string;
}

export interface MetricAverage {
  average: number;
  count: number;
}

export interface EvaluationBucket {
  caseCount: number;
  errorCount: number;
  metrics: Record<string, MetricAverage>;
}

export interface EvaluationSummary {
  overall: EvaluationBucket;
  byTag: Record<string, EvaluationBucket>;
}

export const DEFAULT_EVAL_GATES: Readonly<Record<string, number>> = {
  recallAtK: 0.7,
  precisionAtK: 0.4,
  ndcgAtK: 0.6,
  mrr: 0.6,
  intentAccuracy: 0.85,
  judgePassRate: 0.75,
  judgeScore: 0.7,
  faithfulness: 0.75,
};

function numericMetrics(metrics: CaseEvaluationMetrics): Array<[string, number]> {
  const output: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      output.push([key, value]);
    }
  }
  if (typeof metrics.intentCorrect === "boolean") {
    output.push(["intentAccuracy", metrics.intentCorrect ? 1 : 0]);
  }
  if (typeof metrics.judgePassed === "boolean") {
    output.push(["judgePassRate", metrics.judgePassed ? 1 : 0]);
  }
  return output;
}

function aggregateBucket(details: EvaluationCaseDetail[]): EvaluationBucket {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const detail of details) {
    for (const [metric, value] of numericMetrics(detail.metrics)) {
      const current = sums.get(metric) ?? { sum: 0, count: 0 };
      current.sum += value;
      current.count += 1;
      sums.set(metric, current);
    }
  }

  return {
    caseCount: details.length,
    errorCount: details.filter((detail) => Boolean(detail.error)).length,
    metrics: Object.fromEntries(
      [...sums.entries()].map(([metric, value]) => [
        metric,
        { average: value.sum / value.count, count: value.count },
      ]),
    ),
  };
}

/** 按全量和标签分桶聚合；未产生的维度不会伪造为 0。 */
export function aggregateEvaluation(
  details: EvaluationCaseDetail[],
): EvaluationSummary {
  const tagged = new Map<string, EvaluationCaseDetail[]>();
  for (const detail of details) {
    for (const tag of detail.tags.length > 0 ? detail.tags : ["untagged"]) {
      const bucket = tagged.get(tag) ?? [];
      bucket.push(detail);
      tagged.set(tag, bucket);
    }
  }

  return {
    overall: aggregateBucket(details),
    byTag: Object.fromEntries(
      [...tagged.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
        ([tag, bucket]) => [tag, aggregateBucket(bucket)],
      ),
    ),
  };
}

/** 将 RAGAS 等数据集级旁路指标纳入 overall，且不伪装成每条 case 的结果。 */
export function addOverallMetrics(
  summary: EvaluationSummary,
  metrics: Record<string, number>,
): EvaluationSummary {
  const validMetrics = Object.entries(metrics).filter(
    ([, value]) => Number.isFinite(value),
  );
  if (validMetrics.length === 0) return summary;

  return {
    ...summary,
    overall: {
      ...summary.overall,
      metrics: {
        ...summary.overall.metrics,
        ...Object.fromEntries(
          validMetrics.map(([name, value]) => [name, { average: value, count: 1 }]),
        ),
      },
    },
  };
}

export interface GateDecision {
  passed: boolean;
  failures: Array<{ metric: string; actual: number; threshold: number }>;
  skipped: string[];
}

/**
 * 仅判断本轮真正产出的维度。检索-only 模式没有 judge/intent 指标是正常情况，
 * 不会因为缺失 LLM 维度而失败。
 */
export function gateDecision(
  summary: EvaluationSummary,
  gates: Readonly<Record<string, number>> = DEFAULT_EVAL_GATES,
): GateDecision {
  const failures: GateDecision["failures"] = [];
  const skipped: string[] = [];
  for (const [metric, threshold] of Object.entries(gates)) {
    const result = summary.overall.metrics[metric];
    if (!result || result.count === 0) {
      skipped.push(metric);
      continue;
    }
    if (result.average < threshold) {
      failures.push({ metric, actual: result.average, threshold });
    }
  }

  return { passed: failures.length === 0, failures, skipped };
}
