import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Prisma } from "@prisma/client";
import { SearchService } from "../src/document/search.service";
import { DocumentEmbeddingService } from "../src/document/embedding.service";
import { EmbeddingService } from "../src/llm/embedding/embedding.service";
import { runAnalysisGraph } from "../src/llm/graph/analysis-graph.runner";
import { createChatModel } from "../src/llm/model.factory";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  addOverallMetrics,
  aggregateEvaluation,
  gateDecision,
  type EvaluationCaseDetail,
} from "../rag/evaluation/aggregate";
import { runRagasEvaluation } from "../rag/evaluation/ragas-runner";
import {
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
} from "../rag/evaluation/retrieval-metrics";
import {
  loadRequirementAnalysisDataset,
  type RequirementAnalysisEvalCase,
} from "../eval/dataset-loader";
import { judgeReport } from "../eval/judge";
import { formatRetrievedContext } from "../eval/retrieved-context";

const CHAT_ROOT = resolve(__dirname, "..");
const DATASET_PATH = join(
  CHAT_ROOT,
  "eval/datasets/requirement-analysis.jsonl",
);
const REPORTS_DIR = join(CHAT_ROOT, "eval/reports");
const DEFAULT_EVAL_USER_ID = "eval-user";
const DEFAULT_TOP_K = 5;

interface CliOptions {
  noLlm: boolean;
  caseId?: string;
}

interface EvalRuntimeConfig {
  userId: string;
  topK: number;
}

interface EvalCaseDetail extends EvaluationCaseDetail {
  input: string;
  expectedIntent?: string;
  actualIntent?: string;
  retrievedChunkIds: string[];
  retrievedContext: string;
  summary?: string;
  judgeReasoning?: string;
}

interface EvalReport {
  startedAt: string;
  finishedAt: string;
  gitSha: string | null;
  model: string;
  noLlm: boolean;
  datasetPath: string;
  topK: number;
  details: EvalCaseDetail[];
  summary: ReturnType<typeof aggregateEvaluation>;
  gate: ReturnType<typeof gateDecision>;
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

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = { noLlm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-llm") {
      options.noLlm = true;
      continue;
    }
    if (arg === "--case") {
      options.caseId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--case=")) {
      options.caseId = arg.slice("--case=".length);
      continue;
    }
    throw new Error(`不支持的参数：${arg}`);
  }
  if (options.caseId !== undefined && !options.caseId.trim()) {
    throw new Error("--case 必须指定非空 case id");
  }
  return options;
}

function readRuntimeConfig(): EvalRuntimeConfig {
  const userId = process.env.EVAL_USER_ID?.trim() || DEFAULT_EVAL_USER_ID;
  const topK = Number(process.env.EVAL_TOP_K ?? DEFAULT_TOP_K);
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error("EVAL_TOP_K 必须是正整数");
  }
  return { userId, topK };
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

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part === "object" && "text" in part
          ? String(part.text ?? "")
          : "",
    )
    .join("\n");
}

function csvValue(value: unknown): string {
  const text =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(details: EvalCaseDetail[]): string {
  const headers = [
    "id",
    "tags",
    "expectedIntent",
    "actualIntent",
    "retrievedChunkIds",
    "recallAtK",
    "precisionAtK",
    "ndcgAtK",
    "intentCorrect",
    "judgePassed",
    "judgeScore",
    "faithfulness",
    "error",
  ];
  const rows = details.map((detail) => [
    detail.id,
    detail.tags,
    detail.expectedIntent,
    detail.actualIntent,
    detail.retrievedChunkIds,
    detail.metrics.recallAtK,
    detail.metrics.precisionAtK,
    detail.metrics.ndcgAtK,
    detail.metrics.intentCorrect,
    detail.metrics.judgePassed,
    detail.metrics.judgeScore,
    detail.metrics.faithfulness,
    detail.error,
  ]);
  return [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
}

function printBucket(label: string, bucket: EvalReport["summary"]["overall"]): void {
  const metrics = Object.entries(bucket.metrics)
    .map(([name, value]) => `${name}=${value.average.toFixed(4)} (n=${value.count})`)
    .join(", ");
  console.log(`${label}: cases=${bucket.caseCount}, errors=${bucket.errorCount}${metrics ? `, ${metrics}` : ""}`);
}

async function evaluateCase(
  testCase: RequirementAnalysisEvalCase,
  searchService: SearchService,
  model: BaseChatModel | undefined,
  runtimeConfig: EvalRuntimeConfig,
): Promise<EvalCaseDetail> {
  const detail: EvalCaseDetail = {
    id: testCase.id,
    input: testCase.input,
    tags: testCase.tags,
    expectedIntent: testCase.expectedIntent,
    retrievedChunkIds: [],
    retrievedContext: "",
    metrics: {},
  };

  try {
    // 评估真实检索器，不从 LangGraph output 中读取任何推测的 retrievedIds。
    const retrieved = await searchService.similaritySearch(
      testCase.input,
      runtimeConfig.userId,
      runtimeConfig.topK,
    );
    detail.retrievedChunkIds = retrieved.flatMap((result) =>
      typeof result.id === "string" ? [result.id] : [],
    );
    detail.retrievedContext = formatRetrievedContext(retrieved);

    if (testCase.relevantChunkIds) {
      detail.metrics.recallAtK = recallAtK(
        detail.retrievedChunkIds,
        testCase.relevantChunkIds,
        runtimeConfig.topK,
      );
      detail.metrics.precisionAtK = precisionAtK(
        detail.retrievedChunkIds,
        testCase.relevantChunkIds,
        runtimeConfig.topK,
      );
      detail.metrics.ndcgAtK = ndcgAtK(
        detail.retrievedChunkIds,
        testCase.relevantChunkIds,
        runtimeConfig.topK,
      );
    }

    if (!model) return detail;

    const output = await runAnalysisGraph(testCase.input, detail.retrievedContext, {
      model,
    });
    detail.actualIntent = output.intent;
    if (testCase.expectedIntent) {
      detail.metrics.intentCorrect = output.intent === testCase.expectedIntent;
    }
    detail.summary = output.summary;

    if (
      testCase.expectedIntent === "analyze" &&
      output.summary.trim().length > 0
    ) {
      const judgement = await judgeReport(model, testCase, output.summary);
      detail.metrics.judgePassed = judgement.passed;
      detail.metrics.judgeScore = judgement.score;
      detail.judgeReasoning = judgement.reasoning;
    }
  } catch (error) {
    detail.error = error instanceof Error ? error.message : String(error);
  }

  return detail;
}

async function persistEvalRun(
  prisma: PrismaService,
  report: EvalReport,
  reportPath: string,
): Promise<void> {
  try {
    await prisma.evalRun.create({
      data: {
        gitSha: report.gitSha,
        model: report.model,
        startedAt: new Date(report.startedAt),
        finishedAt: new Date(report.finishedAt),
        overallMetrics:
          report.summary.overall.metrics as unknown as Prisma.InputJsonValue,
        passed: report.gate.passed,
        reportPath,
        reportJson: report as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // 报告文件已是可追溯产物；数据库写失败不应丢弃结果或掩盖 gate 的退出码。
    console.warn(
      `[eval] 写入 eval_runs 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 评测必须依赖真实检索库。SearchService 在产品对话中可以把检索故障降级为
 * 空上下文，但 runner 不能把“数据库不可达”误报成“检索评测通过”。
 */
async function assertEvaluationStoreAvailable(prisma: PrismaService): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `评测无法连接 PostgreSQL，未执行检索指标。请检查 DATABASE_URL 与数据库服务：${reason}`,
    );
  }
}

async function run(): Promise<boolean> {
  loadEnvFile(join(CHAT_ROOT, ".env"));
  const options = parseCli(process.argv.slice(2));
  const runtimeConfig = readRuntimeConfig();

  const dataset = await loadRequirementAnalysisDataset(DATASET_PATH);
  const selected = options.caseId
    ? dataset.filter((testCase) => testCase.id === options.caseId)
    : dataset;
  if (selected.length === 0) {
    throw new Error(`未找到评测 case：${options.caseId}`);
  }

  const startedAt = new Date();
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await assertEvaluationStoreAvailable(prisma);
    const embeddingService = new EmbeddingService({});
    const searchService = new SearchService(
      prisma,
      new DocumentEmbeddingService(embeddingService),
    );
    const model = options.noLlm ? undefined : createChatModel();
    const details: EvalCaseDetail[] = [];

    for (const testCase of selected) {
      console.log(`[eval] ${testCase.id}`);
      details.push(
        await evaluateCase(testCase, searchService, model, runtimeConfig),
      );
    }

    let summary = aggregateEvaluation(details);
    const retrievalCases = details.filter((detail) => {
      const source = selected.find((testCase) => testCase.id === detail.id);
      return source?.relevantChunkIds !== undefined;
    });
    if (retrievalCases.length > 0) {
      const ranked = retrievalCases.map((detail) => detail.retrievedChunkIds);
      const relevant = retrievalCases.map(
        (detail) =>
          selected.find((testCase) => testCase.id === detail.id)?.relevantChunkIds ?? [],
      );
      summary = addOverallMetrics(summary, { mrr: mrr(ranked, relevant) });
    }

    if (process.env.RUN_RAGAS === "1" && model) {
      const ragasSamples = details
        .filter((detail) => detail.summary && detail.input)
        .map((detail) => {
          const source = selected.find((testCase) => testCase.id === detail.id);
          return {
            question: detail.input,
            answer: detail.summary ?? "",
            contexts: detail.retrievedContext ? [detail.retrievedContext] : [],
            ground_truth: source?.groundTruth ?? "",
          };
        });
      if (ragasSamples.length > 0) {
        const ragas = await runRagasEvaluation({
          samples: ragasSamples,
          metrics: ["faithfulness"],
        });
        if (ragas) summary = addOverallMetrics(summary, ragas);
      }
    }

    const gate = gateDecision(summary);
    const finishedAt = new Date();
    const modelName = options.noLlm
      ? "retrieval-only"
      : String((model as { model?: unknown }).model ?? "configured-model");
    const report: EvalReport = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      gitSha: getGitSha(),
      model: modelName,
      noLlm: options.noLlm,
      datasetPath: DATASET_PATH,
      topK: runtimeConfig.topK,
      details,
      summary,
      gate,
    };
    mkdirSync(REPORTS_DIR, { recursive: true });
    const timestamp = finishedAt.toISOString().replaceAll(":", "-").replace(".", "-");
    const jsonPath = join(REPORTS_DIR, `${timestamp}.json`);
    const csvPath = join(REPORTS_DIR, `${timestamp}.csv`);
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(csvPath, `${toCsv(details)}\n`);
    await persistEvalRun(prisma, report, jsonPath);

    printBucket("[eval] overall", summary.overall);
    for (const [tag, bucket] of Object.entries(summary.byTag)) {
      printBucket(`[eval] tag:${tag}`, bucket);
    }
    console.log(`[eval] JSON: ${jsonPath}`);
    console.log(`[eval] CSV: ${csvPath}`);
    if (!gate.passed) {
      console.error("[eval] gate failed:", JSON.stringify(gate.failures));
    }
    if (gate.skipped.length > 0) {
      console.log(`[eval] skipped gates (no results): ${gate.skipped.join(", ")}`);
    }
    return gate.passed;
  } finally {
    await prisma.$disconnect();
  }
}

run()
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error) => {
    console.error(`[eval] runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
