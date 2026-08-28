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
  constructor(private readonly database: DatabaseService) {}

  async recordUsage(record: TokenUsageRecord): Promise<void> {
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
    } catch (error) {
      console.warn("[TokenUsage] 持久化失败，已跳过本次 usage 记录", error);
    }
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
