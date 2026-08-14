import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { SearchService } from "../src/document/search.service";
import { DocumentEmbeddingService } from "../src/document/embedding.service";
import { EmbeddingService } from "../src/llm/embedding/embedding.service";
import { runAnalysisGraph } from "../src/llm/graph/analysis-graph.runner";
import { createChatModel } from "../src/llm/model.factory";
import { PrismaService } from "../src/prisma/prisma.service";
import type {
  ExpectedIntent,
  RequirementAnalysisEvalCase,
} from "../eval/dataset-loader";
import { judgeReport } from "../eval/judge";
import { formatRetrievedContext } from "../eval/retrieved-context";
import {
  precisionAtK,
  recallAtK,
} from "../rag/evaluation/retrieval-metrics";

/**
 * LangSmith tracing uploads prompts, inputs, outputs, and token metadata. Do not
 * enable it for production data before data-residency, redaction, and access
 * controls have been reviewed. The local run-eval.ts remains the CI gate.
 */
const CHAT_ROOT = resolve(__dirname, "..");
const DATASET_NAME = "autix-requirement-analysis";
const DEFAULT_EVAL_USER_ID = "eval-user";
const DEFAULT_TOP_K = 5;

interface EvalConfig {
  apiKey: string;
  userId: string;
  topK: number;
  maxConcurrency: number;
  modelName?: string;
  experimentPrefix: string;
  gitSha: string | null;
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

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function getGitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(CHAT_ROOT, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readConfig(): EvalConfig {
  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 LANGSMITH_API_KEY。请先运行 sync-langsmith-dataset.ts 并配置 LangSmith 凭据。",
    );
  }
  return {
    apiKey,
    userId: process.env.EVAL_USER_ID?.trim() || DEFAULT_EVAL_USER_ID,
    topK: positiveInteger(process.env.EVAL_TOP_K, DEFAULT_TOP_K, "EVAL_TOP_K"),
    maxConcurrency: positiveInteger(
      process.env.LANGSMITH_MAX_CONCURRENCY,
      4,
      "LANGSMITH_MAX_CONCURRENCY",
    ),
    modelName: process.env.LLM_MODEL?.trim() || undefined,
    experimentPrefix:
      process.env.LANGSMITH_EXPERIMENT_PREFIX?.trim() || "hybrid-rag-topK5",
    gitSha: process.env.GIT_SHA?.trim() || getGitSha(),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toTestCase(
  input: Record<string, unknown>,
  referenceOutputs: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
): RequirementAnalysisEvalCase {
  const expectedIntent = referenceOutputs?.expectedIntent;
  return {
    id:
      typeof metadata?.caseId === "string"
        ? metadata.caseId
        : "langsmith-example",
    input: typeof input.input === "string" ? input.input : "",
    tags: asStringArray(metadata?.tags),
    ...(expectedIntent === "analyze" ||
    expectedIntent === "query" ||
    expectedIntent === "chat" ||
    expectedIntent === "risk_only"
      ? { expectedIntent: expectedIntent as ExpectedIntent }
      : {}),
    ...(asStringArray(referenceOutputs?.relevantChunkIds).length > 0
      ? { relevantChunkIds: asStringArray(referenceOutputs?.relevantChunkIds) }
      : {}),
    ...(typeof referenceOutputs?.groundTruthAnswer === "string"
      ? { groundTruth: referenceOutputs.groundTruthAnswer }
      : {}),
  };
}

function configuredModelName(model: BaseChatModel, override?: string): string {
  return override || String((model as { model?: unknown }).model ?? "configured-model");
}

async function run(): Promise<void> {
  loadEnvFile(join(CHAT_ROOT, ".env"));
  // LANGSMITH_PROJECT is kept as the public application setting; the SDK uses
  // LANGSMITH_PROJECT_NAME internally for tracing defaults.
  if (process.env.LANGSMITH_PROJECT?.trim() && !process.env.LANGSMITH_PROJECT_NAME) {
    process.env.LANGSMITH_PROJECT_NAME = process.env.LANGSMITH_PROJECT.trim();
  }
  const config = readConfig();
  const client = new Client({ apiKey: config.apiKey });
  if (!(await client.hasDataset({ datasetName: DATASET_NAME }))) {
    throw new Error(
      `LangSmith Dataset ${DATASET_NAME} 不存在。请先执行 bun run scripts/sync-langsmith-dataset.ts。`,
    );
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const model = createChatModel({ modelName: config.modelName });
    const searchService = new SearchService(
      prisma,
      new DocumentEmbeddingService(new EmbeddingService({})),
    );

    const target = async ({ input }: { input: string }) => {
      const retrieved = await searchService.similaritySearch(
        input,
        config.userId,
        config.topK,
      );
      const retrievedIds = retrieved.flatMap((result) =>
        typeof result.id === "string" ? [result.id] : [],
      );
      const retrievedContext = formatRetrievedContext(retrieved);
      const output = await runAnalysisGraph(input, retrievedContext, { model });
      return {
        intent: output.intent,
        summary: output.summary,
        retrievedIds,
      };
    };

    const reportQuality = async ({
      inputs,
      outputs,
      referenceOutputs,
      example,
    }: {
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
      referenceOutputs?: Record<string, unknown>;
      example: { metadata?: Record<string, unknown> };
    }) => {
      const testCase = toTestCase(inputs, referenceOutputs, example.metadata);
      const summary = typeof outputs.summary === "string" ? outputs.summary.trim() : "";
      if (testCase.expectedIntent !== "analyze" || !summary) return [];
      const judgement = await judgeReport(model, testCase, summary);
      return {
        key: "report_quality",
        score: judgement.score,
        comment: judgement.reasoning,
      };
    };

    const retrievalRecall = ({
      outputs,
      referenceOutputs,
    }: {
      outputs: Record<string, unknown>;
      referenceOutputs?: Record<string, unknown>;
    }) => {
      const relevantIds = asStringArray(referenceOutputs?.relevantChunkIds);
      if (relevantIds.length === 0) return [];
      return {
        key: `recall@${config.topK}`,
        score: recallAtK(asStringArray(outputs.retrievedIds), relevantIds, config.topK),
      };
    };

    const retrievalPrecision = ({
      outputs,
      referenceOutputs,
    }: {
      outputs: Record<string, unknown>;
      referenceOutputs?: Record<string, unknown>;
    }) => {
      const relevantIds = asStringArray(referenceOutputs?.relevantChunkIds);
      if (relevantIds.length === 0) return [];
      return {
        key: `precision@${config.topK}`,
        score: precisionAtK(
          asStringArray(outputs.retrievedIds),
          relevantIds,
          config.topK,
        ),
      };
    };

    const intentMatch = ({
      outputs,
      referenceOutputs,
    }: {
      outputs: Record<string, unknown>;
      referenceOutputs?: Record<string, unknown>;
    }) => {
      const expected = referenceOutputs?.expectedIntent;
      if (typeof expected !== "string") return [];
      return {
        key: "intent_correct",
        score: outputs.intent === expected ? 1 : 0,
      };
    };

    const results = await evaluate(target, {
      data: DATASET_NAME,
      evaluators: [reportQuality, retrievalRecall, retrievalPrecision, intentMatch],
      experimentPrefix: config.experimentPrefix,
      maxConcurrency: config.maxConcurrency,
      metadata: {
        gitSha: config.gitSha ?? "unknown",
        model: configuredModelName(model, config.modelName),
        topK: config.topK,
        promptVersion: "inline",
      },
      client,
    });

    let experimentUrl: string | undefined;
    try {
      experimentUrl = await client.getProjectUrl({
        projectName: results.experimentName,
      });
    } catch (error) {
      console.warn(
        `[langsmith] 无法生成 experiment 链接：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.log(`[langsmith] experiment: ${results.experimentName}`);
    console.log(`[langsmith] completed cases: ${results.length}`);
    if (experimentUrl) console.log(`[langsmith] url: ${experimentUrl}`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(
    `[langsmith] evaluation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
