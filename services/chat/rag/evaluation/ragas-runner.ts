/** RAGAS REST 服务接收的单条评测样本。 */
export interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

export interface RagasEvaluationInput {
  samples: RagasSample[];
  metrics: string[];
}

export type RagasEvaluationResult = Record<string, number>;

export interface RagasRunnerOptions {
  /** 团队封装的 Python RAGAS 服务根地址，默认从环境变量读取。 */
  baseUrl?: string;
  /** 单次 HTTP 请求超时；默认 60 秒。 */
  timeoutMs?: number;
  /** 请求失败后的重试次数；默认重试 3 次（最多共 4 次请求）。 */
  retries?: number;
  /** 便于单元测试注入 mock，默认使用全局 fetch。 */
  fetchFn?: typeof fetch;
  /** 评测是旁路能力，失败只告警，不抛到业务主流程。 */
  warn?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 3;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

/**
 * 调用团队封装的 RAGAS REST 服务。
 *
 * RAGAS 是 Python 库而非自带 HTTP 服务；该 runner 只约定团队服务的
 * `POST /evaluate` 契约。不可用、超时或返回异常时会降级为 null，确保评测服务
 * 不会阻塞主进程或常规对话链路。
 */
export async function runRagasEvaluation(
  input: RagasEvaluationInput,
  options: RagasRunnerOptions = {},
): Promise<RagasEvaluationResult | null> {
  const baseUrl = options.baseUrl ?? process.env.RAGAS_SERVICE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const warn = options.warn ?? console.warn;

  if (!baseUrl) {
    warn("[RAGAS] 服务地址未配置，跳过生成质量评测。");
    return null;
  }
  if (typeof fetchFn !== "function") {
    warn("[RAGAS] 当前运行环境不支持 fetch，跳过生成质量评测。");
    return null;
  }

  const attempts = Math.max(1, Math.floor(retries) + 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(`${normalizeBaseUrl(baseUrl)}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`RAGAS 服务返回 HTTP ${response.status}`);
      }

      const result = (await response.json()) as unknown;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("RAGAS 服务返回了无效的评测结果");
      }

      return Object.fromEntries(
        Object.entries(result).filter(
          ([, value]) => typeof value === "number" && Number.isFinite(value),
        ),
      );
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  warn(
    `[RAGAS] 评测服务在 ${attempts} 次尝试后不可用，已降级跳过：${detail}`,
  );
  return null;
}
