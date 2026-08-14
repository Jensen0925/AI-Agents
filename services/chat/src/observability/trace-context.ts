import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceContext {
  traceId: string;
  startedAt: number;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return randomUUID();
}

export function runWithTrace<T>(
  traceId: string,
  callback: () => T,
): T {
  return traceStorage.run(
    {
      traceId,
      startedAt: Date.now(),
    },
    callback,
  );
}

export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

export function getElapsedMs(): number | undefined {
  const startedAt = traceStorage.getStore()?.startedAt;
  return startedAt === undefined ? undefined : Date.now() - startedAt;
}
