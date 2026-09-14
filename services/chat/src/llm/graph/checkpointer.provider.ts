import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createLogger } from "../../observability/logger";

const log = createLogger("langgraph.checkpointer");

export type PostgresSaverLike = BaseCheckpointSaver & {
  setup(): Promise<void>;
};

/** 仅需要 `end()` 的最小连接池契约，避免把 `pg` 的类型泄漏到调用方。 */
interface ClosablePool {
  end(): Promise<void>;
}

/**
 * checkpointer 连接池上限。
 *
 * 这是**整个进程共享**的一个池，不是每请求一个——上限只需覆盖并发图执行的
 * 峰值，而不是并发 HTTP 请求数。
 */
const CHECKPOINTER_POOL_MAX = 4;

let sharedCheckpointer: PostgresSaverLike | undefined;
let sharedPool: ClosablePool | undefined;
let pending: Promise<PostgresSaverLike | undefined> | undefined;

async function build(): Promise<PostgresSaverLike | undefined> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return undefined;

  try {
    const [checkpointModule, pgModule] = await Promise.all([
      import("@langchain/langgraph-checkpoint-postgres") as Promise<{
        PostgresSaver?: new (pool: unknown) => PostgresSaverLike;
      }>,
      import("pg") as Promise<{
        Pool?: new (config: { connectionString: string; max: number }) => ClosablePool;
        default?: {
          Pool?: new (config: { connectionString: string; max: number }) => ClosablePool;
        };
      }>,
    ]);

    const PostgresSaver = checkpointModule.PostgresSaver;
    if (!PostgresSaver) throw new Error("PostgresSaver export is unavailable");

    const Pool = pgModule.Pool ?? pgModule.default?.Pool;
    if (!Pool) throw new Error("pg.Pool export is unavailable");

    // 自己持有连接池而不是用 PostgresSaver.fromConnString()：后者的 pool 是
    // private，进程退出时无法关闭，会造成连接泄漏。
    const pool = new Pool({
      connectionString: databaseUrl,
      max: CHECKPOINTER_POOL_MAX,
    });
    const checkpointer = new PostgresSaver(pool);
    await checkpointer.setup();

    sharedPool = pool;
    return checkpointer;
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "PostgreSQL checkpoint 未启用，继续使用无持久化图",
    );
    return undefined;
  }
}

/**
 * 取得进程级共享的 PostgreSQL checkpointer。
 *
 * 连接池与建表 DDL 只在首次调用时执行一次，避免每个请求各建一个连接池、
 * 重复跑 `setup()`，从而在高并发下打满 PostgreSQL 连接数并制造 catalog 锁竞争。
 *
 * 并发调用会共享同一个进行中的 Promise（只建一次）；失败**不会**被永久缓存，
 * 后续请求可以重试。
 */
export function getSharedCheckpointer(): Promise<PostgresSaverLike | undefined> {
  if (sharedCheckpointer) return Promise.resolve(sharedCheckpointer);
  if (pending) return pending;

  pending = build()
    .then((result) => {
      if (result) sharedCheckpointer = result;
      return result;
    })
    .finally(() => {
      pending = undefined;
    });

  return pending;
}

/** 释放共享 checkpointer 的连接池；应在应用关闭时调用。 */
export async function disposeSharedCheckpointer(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  sharedCheckpointer = undefined;
  pending = undefined;
  if (!pool) return;

  try {
    await pool.end();
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "关闭 checkpointer 连接池失败",
    );
  }
}
