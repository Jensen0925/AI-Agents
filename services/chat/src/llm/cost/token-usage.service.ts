import { desc, gte, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { tokenUsages } from "../../database/schema";

export interface TokenUsageRecord {
  conversationId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  graphName: string;
  nodeName: string;
  agentName: string;
  modelConfigId?: string | null;
  modelName: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number | null;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
  isEstimated?: boolean;
  latencyMs?: number;
  overrideReason?: string | null;
  createdAt?: Date;
}

export interface MonthlyStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  calls: number;
}

export interface NodeUsageStats {
  nodeName: string;
  totalCost: number;
  calls: number;
}

export interface AgentUsageStats {
  agentName: string;
  totalCost: number;
  calls: number;
}

/** Token usage 的 PostgreSQL 持久化与聚合查询服务。 */
export class TokenUsageService {
  /**
   * 写入失败时的待重试队列上限。成本核算数据可以容忍少量丢失，但绝不能
   * 让一次数据库抖动把无界记录堆在内存里（长生命周期进程下会变成内存泄漏）。
   */
  private static readonly MAX_PENDING_RECORDS = 500;
  private static readonly RETRY_DELAY_MS = 5_000;

  private readonly pending: TokenUsageRecord[] = [];
  private retryTimer?: NodeJS.Timeout;
  private flushing = false;

  constructor(private readonly database: DatabaseService) {}

  async recordUsage(record: TokenUsageRecord): Promise<void> {
    // 先尝试直写；失败则进入重试队列，不能直接丢弃。
    // 成本数据是预算熔断的输入，静默丢失会让熔断长期失效。
    if (await this.persist(record)) return;
    this.enqueue(record);
  }

  /** 立即重试队列中的记录；供关机流程与测试调用。 */
  async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, this.pending.length);
        let firstFailure = -1;
        for (let index = 0; index < batch.length; index += 1) {
          if (!(await this.persist(batch[index]!))) {
            firstFailure = index;
            break;
          }
        }
        if (firstFailure >= 0) {
          // 失败项及其后的记录重新入队，等待下一次重试；仍然受容量上限约束。
          this.pending.unshift(...batch.slice(firstFailure));
          this.trimPending();
          this.scheduleFlush();
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** 关机时清理定时器，避免 Node 事件循环被未决 timer 挂住。 */
  dispose(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private async persist(record: TokenUsageRecord): Promise<boolean> {
    const inputTokens = record.inputTokens ?? 0;
    const outputTokens = record.outputTokens ?? 0;

    try {
      await this.database.db.insert(tokenUsages).values({
        id: crypto.randomUUID(),
        conversationId: record.conversationId ?? null,
        messageId: record.messageId ?? null,
        threadId: record.threadId ?? null,
        graphName: record.graphName,
        nodeName: record.nodeName,
        agentName: record.agentName,
        modelConfigId: record.modelConfigId ?? null,
        modelName: record.modelName,
        provider: record.provider ?? "openai",
        inputTokens,
        outputTokens,
        totalTokens: record.totalTokens ?? inputTokens + outputTokens,
        cachedInputTokens: record.cachedInputTokens ?? 0,
        estimatedCostUsd: record.estimatedCostUsd ?? 0,
        isEstimated: record.isEstimated ?? false,
        latencyMs: record.latencyMs ?? 0,
        overrideReason: record.overrideReason ?? null,
        ...(record.createdAt ? { createdAt: record.createdAt } : {}),
      });
      return true;
    } catch (error) {
      console.warn("[TokenUsage] 持久化失败，已进入重试队列", error);
      return false;
    }
  }

  private enqueue(record: TokenUsageRecord): void {
    this.pending.push(record);
    this.trimPending();
    this.scheduleFlush();
  }

  private trimPending(): void {
    const overflow = this.pending.length - TokenUsageService.MAX_PENDING_RECORDS;
    if (overflow > 0) {
      // 丢弃最旧的记录，保留最新用量（成本核算更关心近期窗口）。
      this.pending.splice(0, overflow);
      console.warn(
        `[TokenUsage] 重试队列已满，丢弃 ${overflow} 条最旧的 usage 记录`,
      );
    }
  }

  private scheduleFlush(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flushPending();
    }, TokenUsageService.RETRY_DELAY_MS);
    // 不要让重试定时器阻止进程退出。
    this.retryTimer.unref?.();
  }

  async getMonthlyStats(): Promise<MonthlyStats> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [result] = await this.database.db
      .select({
        totalCost: sql<number>`coalesce(sum(${tokenUsages.estimatedCostUsd}), 0)`,
        totalInputTokens: sql<number>`coalesce(sum(${tokenUsages.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${tokenUsages.outputTokens}), 0)`,
        totalCachedTokens: sql<number>`coalesce(sum(${tokenUsages.cachedInputTokens}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(tokenUsages)
      .where(gte(tokenUsages.createdAt, monthStart));

    return {
      totalCost: Number(result?.totalCost ?? 0),
      totalInputTokens: Number(result?.totalInputTokens ?? 0),
      totalOutputTokens: Number(result?.totalOutputTokens ?? 0),
      totalCachedTokens: Number(result?.totalCachedTokens ?? 0),
      calls: Number(result?.calls ?? 0),
    };
  }

  async getStatsByNode(): Promise<NodeUsageStats[]> {
    const rows = await this.database.db
      .select({
        nodeName: tokenUsages.nodeName,
        totalCost: sql<number>`coalesce(sum(${tokenUsages.estimatedCostUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(tokenUsages)
      .groupBy(tokenUsages.nodeName)
      .orderBy(desc(sql`sum(${tokenUsages.estimatedCostUsd})`));

    return rows.map((row) => ({
      nodeName: row.nodeName,
      totalCost: Number(row.totalCost),
      calls: Number(row.calls),
    }));
  }

  async getStatsByAgent(): Promise<AgentUsageStats[]> {
    const rows = await this.database.db
      .select({
        agentName: tokenUsages.agentName,
        totalCost: sql<number>`coalesce(sum(${tokenUsages.estimatedCostUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(tokenUsages)
      .groupBy(tokenUsages.agentName)
      .orderBy(desc(sql`sum(${tokenUsages.estimatedCostUsd})`));

    return rows.map((row) => ({
      agentName: row.agentName,
      totalCost: Number(row.totalCost),
      calls: Number(row.calls),
    }));
  }

  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    const stats = await this.getMonthlyStats();
    return stats.totalCost >= monthlyBudgetUsd;
  }
}
