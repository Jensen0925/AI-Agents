import { readFile } from "node:fs/promises";

export type ExpectedIntent = "analyze" | "query" | "chat" | "risk_only";

export interface RequirementAnalysisEvalCase {
  id: string;
  input: string;
  tags: string[];
  expectedIntent?: ExpectedIntent;
  /**
   * 与 document_chunks.id 精确对应的 gold 标注。没有该字段时仍执行真实检索，
   * 但不会把该 case 纳入检索指标分母。
   */
  relevantChunkIds?: string[];
  /** 供报告 Judge 和可选 RAGAS faithfulness 使用的人工事实基准。 */
  groundTruth?: string;
}

function asStringArray(value: unknown, field: string, lineNumber: number): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`评测数据第 ${lineNumber} 行的 ${field} 必须是字符串数组`);
  }
  return value;
}

function parseCase(line: string, lineNumber: number): RequirementAnalysisEvalCase {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `评测数据第 ${lineNumber} 行不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`评测数据第 ${lineNumber} 行必须是 JSON 对象`);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new Error(`评测数据第 ${lineNumber} 行缺少非空 id`);
  }
  if (typeof record.input !== "string" || !record.input.trim()) {
    throw new Error(`评测数据第 ${lineNumber} 行缺少非空 input`);
  }

  const expectedIntent = record.expectedIntent;
  if (
    expectedIntent !== undefined &&
    expectedIntent !== "analyze" &&
    expectedIntent !== "query" &&
    expectedIntent !== "chat" &&
    expectedIntent !== "risk_only"
  ) {
    throw new Error(`评测数据第 ${lineNumber} 行的 expectedIntent 不合法`);
  }

  return {
    id: record.id.trim(),
    input: record.input.trim(),
    tags:
      record.tags === undefined
        ? []
        : asStringArray(record.tags, "tags", lineNumber),
    ...(expectedIntent ? { expectedIntent } : {}),
    ...(record.relevantChunkIds === undefined
      ? {}
      : {
          relevantChunkIds: asStringArray(
            record.relevantChunkIds,
            "relevantChunkIds",
            lineNumber,
          ),
        }),
    ...(typeof record.groundTruth === "string"
      ? { groundTruth: record.groundTruth }
      : {}),
  };
}

/** 加载 JSONL golden dataset；错误带行号，便于在 CI 中直接定位数据问题。 */
export async function loadRequirementAnalysisDataset(
  path: string,
): Promise<RequirementAnalysisEvalCase[]> {
  const content = await readFile(path, "utf8");
  const cases = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"))
    .map(({ line, lineNumber }) => parseCase(line, lineNumber));

  if (cases.length === 0) {
    throw new Error(`评测数据集为空：${path}`);
  }

  const seenIds = new Set<string>();
  for (const testCase of cases) {
    if (seenIds.has(testCase.id)) {
      throw new Error(`评测数据集存在重复 case id：${testCase.id}`);
    }
    seenIds.add(testCase.id);
  }

  return cases;
}
