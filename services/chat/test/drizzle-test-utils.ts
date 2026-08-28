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
