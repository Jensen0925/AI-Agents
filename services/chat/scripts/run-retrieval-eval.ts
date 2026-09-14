import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../src/database/database.service";
import { documentChunks, documents } from "../src/database/schema";
import {
  DOCUMENT_EMBEDDING_MODEL,
  DocumentEmbeddingService,
} from "../src/document/embedding.service";
import { SearchService } from "../src/document/search.service";
import { EmbeddingService } from "../src/llm/embedding/embedding.service";
import {
  addOverallMetrics,
  aggregateEvaluation,
  DEFAULT_EVAL_GATES,
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
  RETRIEVAL_FIXTURE_CHUNKS,
  RETRIEVAL_FIXTURE_PREFIX,
  RETRIEVAL_FIXTURE_QUERIES,
  RETRIEVAL_FIXTURE_TOP_K,
  RETRIEVAL_FIXTURE_USER_ID,
  retrievalFixtureDocuments,
} from "../eval/retrieval-fixture";
import { CHAT_ROOT } from "./script-paths";

/**
 * 生产检索路径的数据库级评测。
 *
 * 自带一份确定性 corpus（`eval/retrieval-fixture.ts`），落到**真实 pgvector** 上、
 * 用**真实 embedding 模型**向量化，再调用**生产入口** `SearchService.search()`
 * 取回结果，与 gold chunk id 计算 recall/precision/ndcg/mrr 并套用同一套门禁。
 * 覆盖 HNSW 索引、`vector(384)` 维度约束、`<=>` 排序、minScore 过滤，
 * 以及 hybrid 的 BM25+RRF+重排链路。
 *
 * 用法：
 *   pnpm --filter @cloudsage/chat eval:retrieval           # 跑完清理 fixture
 *   pnpm --filter @cloudsage/chat eval:retrieval -- --keep # 保留 fixture 便于排查
 *
 * 需要 DATABASE_URL（pgvector 已启用）与本地 embedding 模型。
 */

const DEFAULT_TOP_K = RETRIEVAL_FIXTURE_TOP_K;

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

function readTopK(): number {
  const topK = Number(process.env.EVAL_TOP_K ?? DEFAULT_TOP_K);
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error("EVAL_TOP_K 必须是正整数");
  }
  return topK;
}

/** 评测必须依赖真实检索库；把「连不上」与「检索质量差」区分开。 */
async function assertStoreAvailable(database: DatabaseService): Promise<void> {
  try {
    await database.db.execute(sql`SELECT 1`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `评测无法连接 PostgreSQL，未执行检索指标。请检查 DATABASE_URL 与数据库服务：${reason}`,
    );
  }
  try {
    await database.db.execute(sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`pgvector 扩展不可用，无法评测向量检索：${reason}`);
  }
}

/** 清掉上一轮可能残留的 fixture 行（documents 级联删除 document_chunks）。 */
async function cleanupFixture(database: DatabaseService): Promise<void> {
  await database.db
    .delete(documents)
    .where(sql`${documents.id} LIKE ${`${RETRIEVAL_FIXTURE_PREFIX}%`}`);
}

async function seedFixture(
  database: DatabaseService,
  embedder: DocumentEmbeddingService,
): Promise<void> {
  const vectors = await embedder.embedTexts(
    RETRIEVAL_FIXTURE_CHUNKS.map((chunk) => chunk.content),
  );
  if (vectors.length !== RETRIEVAL_FIXTURE_CHUNKS.length) {
    throw new Error(
      `embedding 数量与语料块数量不一致：${vectors.length} != ${RETRIEVAL_FIXTURE_CHUNKS.length}`,
    );
  }

  await database.db.insert(documents).values(
    retrievalFixtureDocuments().map((doc) => ({
      id: doc.id,
      userId: RETRIEVAL_FIXTURE_USER_ID,
      filename: doc.filename,
      mimeType: "text/plain",
      size: 0,
      category: "product",
      status: "processed",
      chunkCount: RETRIEVAL_FIXTURE_CHUNKS.filter(
        (chunk) => chunk.documentId === doc.id,
      ).length,
    })),
  );

  await database.db.insert(documentChunks).values(
    RETRIEVAL_FIXTURE_CHUNKS.map((chunk, index) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      embedding: vectors[index] ?? [],
      modelName: DOCUMENT_EMBEDDING_MODEL,
    })),
  );
}

interface EvalOutcome {
  detail: EvaluationCaseDetail;
  retrievedIds: string[];
  /** 检索链路是否降级过（基础设施故障必须与「检索质量差」区分）。 */
  degraded: string[];
}

async function evaluateQueries(
  searchService: SearchService,
  topK: number,
): Promise<EvalOutcome[]> {
  const outcomes: EvalOutcome[] = [];
  for (const query of RETRIEVAL_FIXTURE_QUERIES) {
    const degraded: string[] = [];
    const retrieved = await searchService.search(
      query.input,
      RETRIEVAL_FIXTURE_USER_ID,
      topK,
      undefined,
      (reason) => degraded.push(reason),
    );
    const retrievedIds = retrieved.flatMap((item) =>
      typeof item.id === "string" ? [item.id] : [],
    );
    outcomes.push({
      retrievedIds,
      degraded,
      detail: {
        id: query.id,
        tags: ["retrieval"],
        metrics: {
          recallAtK: recallAtK(retrievedIds, query.relevantChunkIds, topK),
          precisionAtK: precisionAtK(retrievedIds, query.relevantChunkIds, topK),
          ndcgAtK: ndcgAtK(retrievedIds, query.relevantChunkIds, topK),
        },
      },
    });
  }
  return outcomes;
}

async function run(): Promise<boolean> {
  loadEnvFile(join(CHAT_ROOT, ".env"));
  const keep = process.argv.slice(2).includes("--keep");
  const topK = readTopK();

  const database = new DatabaseService();
  await database.connect();
  const embedder = new DocumentEmbeddingService(new EmbeddingService({}));
  const searchService = new SearchService(database, embedder);

  try {
    await assertStoreAvailable(database);
    await cleanupFixture(database);
    await seedFixture(database, embedder);
    console.log(
      `[retrieval-eval] 已写入 ${RETRIEVAL_FIXTURE_CHUNKS.length} 个语料块（topK=${topK}）`,
    );

    const outcomes = await evaluateQueries(searchService, topK);
    const degraded = outcomes.flatMap((outcome) => outcome.degraded);
    if (degraded.length > 0) {
      // 降级会让检索静默退化为空结果，此时算出来的指标毫无意义。
      throw new Error(
        `检索链路发生降级，评测结果不可信：${degraded.join(" | ")}`,
      );
    }

    let summary = aggregateEvaluation(outcomes.map((outcome) => outcome.detail));
    summary = addOverallMetrics(summary, {
      mrr: mrr(
        outcomes.map((outcome) => outcome.retrievedIds),
        RETRIEVAL_FIXTURE_QUERIES.map((query) => query.relevantChunkIds),
      ),
    });

    for (const outcome of outcomes) {
      console.log(
        `[retrieval-eval] ${outcome.detail.id}: ${
          outcome.retrievedIds.join(", ") || "<空>"
        }`,
      );
    }
    for (const [metric, value] of Object.entries(summary.overall.metrics)) {
      console.log(
        `[retrieval-eval] ${metric}=${value.average.toFixed(4)} (n=${value.count})`,
      );
    }

    const gate = gateDecision(summary, DEFAULT_EVAL_GATES, {
      required: ["recallAtK", "precisionAtK", "ndcgAtK", "mrr"],
    });
    if (!gate.passed) {
      console.error("[retrieval-eval] gate failed:", JSON.stringify(gate.failures));
    }
    if (gate.missing.length > 0) {
      console.error(
        `[retrieval-eval] required metrics missing: ${gate.missing.join(", ")}`,
      );
    }
    return gate.passed;
  } finally {
    if (!keep) {
      await cleanupFixture(database).catch((error: unknown) => {
        console.warn(
          `[retrieval-eval] 清理 fixture 失败：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    } else {
      console.log("[retrieval-eval] --keep 已指定，保留 fixture 行供排查");
    }
    await database.disconnect();
  }
}

run()
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error) => {
    console.error(
      `[retrieval-eval] runner failed: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
    process.exit(1);
  });
