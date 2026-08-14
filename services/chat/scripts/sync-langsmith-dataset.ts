import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "langsmith";
import {
  loadRequirementAnalysisDataset,
  type RequirementAnalysisEvalCase,
} from "../eval/dataset-loader";

/**
 * LangSmith tracing and datasets can upload prompts, inputs, outputs, and token
 * metadata to an external service. Before enabling it for production data,
 * apply the project's data residency, redaction, and access-control policies.
 */
const CHAT_ROOT = resolve(__dirname, "..");
const DATASET_NAME = "autix-requirement-analysis";
const DATASET_PATH = join(
  CHAT_ROOT,
  "eval/datasets/requirement-analysis.jsonl",
);

interface SyncCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ caseId: string; error: string }>;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function examplePayload(testCase: RequirementAnalysisEvalCase) {
  return {
    inputs: { input: testCase.input },
    outputs: {
      expectedIntent: testCase.expectedIntent ?? null,
      relevantChunkIds: testCase.relevantChunkIds ?? [],
      groundTruthAnswer: testCase.groundTruth ?? "",
    },
    metadata: {
      tags: testCase.tags,
      caseId: testCase.id,
    },
  };
}

function matchesPayload(
  existing: {
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  desired: ReturnType<typeof examplePayload>,
): boolean {
  // LangSmith has no caseId-native example upsert. metadata.caseId is our stable
  // identity; compare the fields we own so reruns neither duplicate nor rewrite
  // an unchanged example.
  return (
    stableJson(existing.inputs) === stableJson(desired.inputs) &&
    stableJson(existing.outputs) === stableJson(desired.outputs) &&
    stableJson({
      caseId: existing.metadata?.caseId,
      tags: existing.metadata?.tags,
    }) === stableJson(desired.metadata)
  );
}

async function ensureDataset(client: Client) {
  if (await client.hasDataset({ datasetName: DATASET_NAME })) {
    return client.readDataset({ datasetName: DATASET_NAME });
  }

  return client.createDataset(DATASET_NAME, {
    description: "Chapter 17 local golden cases for requirement-analysis evaluation.",
    dataType: "kv",
  });
}

async function run(): Promise<SyncCounts> {
  loadEnvFile(join(CHAT_ROOT, ".env"));
  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 LANGSMITH_API_KEY。请在 services/chat/.env 或当前环境中配置后再同步数据集。",
    );
  }

  const client = new Client({ apiKey });
  const dataset = await ensureDataset(client);
  const existingByCaseId = new Map<
    string,
    {
      id: string;
      inputs?: Record<string, unknown>;
      outputs?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  >();
  for await (const example of client.listExamples({ datasetId: dataset.id })) {
    const caseId = example.metadata?.caseId;
    if (typeof caseId === "string" && !existingByCaseId.has(caseId)) {
      existingByCaseId.set(caseId, example);
    }
  }

  const counts: SyncCounts = { created: 0, updated: 0, skipped: 0, failed: [] };
  const cases = await loadRequirementAnalysisDataset(DATASET_PATH);
  for (const testCase of cases) {
    const desired = examplePayload(testCase);
    try {
      const existing = existingByCaseId.get(testCase.id);
      if (!existing) {
        await client.createExample({ dataset_id: dataset.id, ...desired });
        counts.created += 1;
      } else if (matchesPayload(existing, desired)) {
        counts.skipped += 1;
      } else {
        await client.updateExample({ id: existing.id, ...desired });
        counts.updated += 1;
      }
    } catch (error) {
      counts.failed.push({
        caseId: testCase.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`[langsmith] dataset: ${DATASET_NAME}`);
  console.log(
    `[langsmith] synced: created=${counts.created}, updated=${counts.updated}, skipped=${counts.skipped}, failed=${counts.failed.length}`,
  );
  for (const failure of counts.failed) {
    console.error(`[langsmith] failed ${failure.caseId}: ${failure.error}`);
  }
  return counts;
}

run()
  .then((counts) => {
    if (counts.failed.length > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(
      `[langsmith] dataset sync failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
