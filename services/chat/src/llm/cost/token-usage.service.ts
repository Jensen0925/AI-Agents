import type { PrismaClient } from "@prisma/client";

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

/**
 * Token usage 的 PostgreSQL 持久化与聚合查询服务。
 *
 * 写入属于观测侧路：数据库暂不可用时只记录警告，不影响模型主流程。
 */
export class TokenUsageService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordUsage(record: TokenUsageRecord): Promise<void> {
    const inputTokens = record.inputTokens ?? 0;
    const outputTokens = record.outputTokens ?? 0;

    try {
      await this.prisma.tokenUsage.create({
        data: {
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
        },
      });
    } catch (error) {
      console.warn("[TokenUsage] 持久化失败，已跳过本次 usage 记录", error);
    }
  }

  async getMonthlyStats(): Promise<MonthlyStats> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const result = await this.prisma.tokenUsage.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: {
        estimatedCostUsd: true,
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
      },
      _count: { _all: true },
    });

    return {
      totalCost: result._sum.estimatedCostUsd ?? 0,
      totalInputTokens: result._sum.inputTokens ?? 0,
      totalOutputTokens: result._sum.outputTokens ?? 0,
      totalCachedTokens: result._sum.cachedInputTokens ?? 0,
      calls: result._count._all,
    };
  }

  async getStatsByNode(): Promise<NodeUsageStats[]> {
    const rows = await this.prisma.tokenUsage.groupBy({
      by: ["nodeName"],
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: "desc" } },
    });

    return rows.map((row) => ({
      nodeName: row.nodeName,
      totalCost: row._sum.estimatedCostUsd ?? 0,
      calls: row._count._all,
    }));
  }

  async getStatsByAgent(): Promise<AgentUsageStats[]> {
    const rows = await this.prisma.tokenUsage.groupBy({
      by: ["agentName"],
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: "desc" } },
    });

    return rows.map((row) => ({
      agentName: row.agentName,
      totalCost: row._sum.estimatedCostUsd ?? 0,
      calls: row._count._all,
    }));
  }

  async isOverBudget(monthlyBudgetUsd: number): Promise<boolean> {
    const stats = await this.getMonthlyStats();
    return stats.totalCost >= monthlyBudgetUsd;
  }
}
