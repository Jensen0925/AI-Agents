import { vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service";

type QueueOptions = {
  select?: unknown[];
  returning?: unknown[];
  execute?: unknown[];
};

type QueryChain = Record<string, unknown>;

function dequeue(queue: unknown[], fallback: unknown): unknown {
  return queue.length > 0 ? queue.shift() : fallback;
}

function chainFor(
  result: unknown,
  returningQueue: unknown[],
  onValues?: (values: unknown) => void,
): QueryChain {
  const chain: QueryChain = {};
  let values: unknown;
  const passthrough = [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
    "values",
    "set",
    "groupBy",
  ];

  for (const method of passthrough) {
    chain[method] = vi.fn((input?: unknown) => {
      if (method === "values") {
        values = input;
        onValues?.(Array.isArray(input) ? input[0] : input);
      }
      return chain;
    });
  }

  chain.returning = vi.fn(async () => {
    const next = dequeue(returningQueue, result);
    return typeof next === "function"
      ? (next as (input: unknown) => unknown)(
          Array.isArray(values) ? values[0] : values,
        )
      : next;
  });
  chain.catch = (
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).catch(onRejected);
  chain.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

export function createDatabaseMock(options: QueueOptions = {}): DatabaseService {
  const selectQueue = [...(options.select ?? [])];
  const returningQueue = [...(options.returning ?? [])];
  const executeQueue = [...(options.execute ?? [])];
  const database: Record<string, unknown> = {};
  let lastValues: unknown;

  database.select = vi.fn(() => {
    const result = dequeue(selectQueue, []);
    return chainFor(
      typeof result === "function"
        ? (result as (values: unknown) => unknown)(lastValues)
        : result,
      returningQueue,
    );
  });
  database.selectDistinctOn = vi.fn(() => {
    const result = dequeue(selectQueue, []);
    return chainFor(
      typeof result === "function"
        ? (result as (values: unknown) => unknown)(lastValues)
        : result,
      returningQueue,
    );
  });
  database.insert = vi.fn(() =>
    chainFor([], returningQueue, (values) => {
      lastValues = values;
    }),
  );
  database.update = vi.fn(() =>
    chainFor([], returningQueue, (values) => {
      lastValues = values;
    }),
  );
  database.delete = vi.fn(() => chainFor([], returningQueue));
  database.execute = vi.fn(async () => dequeue(executeQueue, []));
  database.transaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
    callback(database),
  );

  return { db: database } as unknown as DatabaseService;
}

export function chainResult(value: unknown): QueryChain {
  return chainFor(value, []);
}

/**
 * 从 drizzle 的 SQL 对象里抽出可读文本，用于按「SQL 内容」而不是「调用顺序」
 * 分派 mock：hybrid 检索用 Promise.all 并发跑向量与 BM25 两路召回，两次
 * db.execute 的先后顺序并不确定，依赖调用序号的测试会随机失败。
 */
export function sqlText(query: unknown): string {
  return sqlValues(query)
    .filter((value): value is string => typeof value === "string")
    .join("");
}

/** 递归收集 SQL 中的字符串片段与绑定参数。 */
export function sqlValues(query: unknown): unknown[] {
  // drizzle 的 sql`` 模板把字面量放在 StringChunk.value（string[]）里，
  // 绑定参数则直接以原始值（string/number/boolean）作为 chunk。
  if (
    typeof query === "string" ||
    typeof query === "number" ||
    typeof query === "boolean"
  ) {
    return [query];
  }
  const chunks = (query as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap((chunk) => {
    const nested = (chunk as { queryChunks?: unknown[] } | null)?.queryChunks;
    if (Array.isArray(nested)) return sqlValues(chunk);
    const value = (chunk as { value?: unknown } | null)?.value;
    if (Array.isArray(value)) return value;
    if (value !== undefined) return [value];
    return sqlValues(chunk);
  });
}
