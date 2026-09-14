export class ToolQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolQuotaError";
  }
}

export class ToolTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolTimeoutError";
  }
}

/**
 * 配额来源。只要实现 `limit` 与 `tryConsume`，就可以把内存实现替换为
 * Redis 等跨实例实现，而不用改调用方。
 */
export interface ToolQuota {
  readonly limit: number;
  tryConsume(key: string): boolean;
}

/** In-memory quota tracker. Deployments needing cross-instance limits can replace it with Redis. */
export class QuotaTracker implements ToolQuota {
  private readonly used = new Map<string, number>();

  constructor(readonly limit = 30) {}

  tryConsume(key: string): boolean {
    const current = this.used.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.used.set(key, current + 1);
    return true;
  }

  consumed(key: string): number {
    return this.used.get(key) ?? 0;
  }
}

export interface ToolGuardContext {
  conversationId: string;
  quota: ToolQuota;
}

export async function withToolGuards<T>(
  toolName: string,
  context: ToolGuardContext,
  fn: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  if (!context.quota.tryConsume(context.conversationId)) {
    throw new ToolQuotaError(`会话工具调用超配额（上限 ${context.quota.limit}）`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(`${toolName} 超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
