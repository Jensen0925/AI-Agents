import { createLogger } from "../observability/logger";
import { AuditLogger, type AuditEvent } from "./audit-logger";
import {
  type GuardResult,
  HARDENED_SYSTEM_SUFFIX,
  inspectExternalContent,
  inspectInput,
} from "./input-guard";
import { KillSwitch } from "./kill-switch";
import {
  classify,
  isAllowed,
  requiresApproval,
  type ToolLevel,
} from "./tool-policy";
import { QuotaTracker, type ToolQuota, withToolGuards } from "./tool-runtime";

const auditSink = createLogger("security.audit");

/** 工具调用总时限：外部 MCP Server 卡住时不能拖垮整轮分析。 */
const TOOL_TIMEOUT_MS = 30_000;

/** 单会话在每个时间窗内的工具调用上限。 */
const TOOL_QUOTA_LIMIT = 120;
const TOOL_QUOTA_WINDOW_MS = 60_000;

/** 未注册工具被拒绝时抛出的错误，供调用方区分「策略拒绝」与其他故障。 */
export class ToolPolicyDeniedError extends Error {
  /** 机器可读的错误码：调用方据此构造稳定的降级响应，不依赖本地化消息。 */
  readonly code = "tool_not_allowed";

  constructor(
    readonly toolName: string,
    readonly level: ToolLevel,
  ) {
    super(`工具 ${toolName} 未在策略白名单中（level=${level}），已拒绝调用`);
    this.name = "ToolPolicyDeniedError";
  }
}

/**
 * 带时间窗的配额。
 *
 * `QuotaTracker` 只增不减，直接长期复用会让一个会话在累计 N 次调用后
 * **永久**失效。这里按固定窗口重建计数器，语义为「每窗口最多 N 次」。
 */
class WindowedQuota implements ToolQuota {
  private tracker = new QuotaTracker(TOOL_QUOTA_LIMIT);
  private windowStartedAt = Date.now();

  get limit(): number {
    return TOOL_QUOTA_LIMIT;
  }

  tryConsume(key: string): boolean {
    if (Date.now() - this.windowStartedAt >= TOOL_QUOTA_WINDOW_MS) {
      this.tracker = new QuotaTracker(TOOL_QUOTA_LIMIT);
      this.windowStartedAt = Date.now();
    }
    return this.tracker.tryConsume(key);
  }
}

export interface ToolCallContext {
  userId: string;
  toolName: string;
  intent?: string;
  conversationId?: string;
  traceId?: string;
}

export interface ToolGuard {
  guardToolCall<T>(context: ToolCallContext, fn: () => Promise<T>): Promise<T>;
}

/**
 * 进程级安全运行时：安全能力的生产接入点。
 *
 * - 用户输入与外部内容 → `input-guard`（注入检测 → 上下文加固 + 审计）
 * - MCP 工具调用 → `tool-policy`（白名单 fail-closed）+ 配额 + 超时 + 审计
 * - 全局 → `kill-switch`（紧急停止，阻断新的模型调用）
 *
 * 设计取舍：检测到疑似注入**不丢弃**输入（可能只是正常的安全讨论），
 * 而是提高模型的指令优先级意识并留痕，避免把可用性换成误报。
 */
export class SecurityRuntime {
  readonly killSwitch = new KillSwitch();

  readonly audit = new AuditLogger((event: AuditEvent) => {
    const payload = {
      eventType: event.eventType,
      severity: event.severity,
      actor: event.actor,
      target: event.target,
      outcome: event.outcome,
      details: event.details,
      traceId: event.traceId ?? undefined,
    };
    if (event.severity === "critical") {
      auditSink.error(payload, "security audit event");
      return;
    }
    if (event.severity === "warn") {
      auditSink.warn(payload, "security audit event");
      return;
    }
    auditSink.info(payload, "security audit event");
  });

  /** 供 MCPManager 直接注入的工具守卫。 */
  readonly toolGuard: ToolGuard = {
    guardToolCall: <T>(context: ToolCallContext, fn: () => Promise<T>) =>
      this.guardToolCall(context, fn),
  };

  private readonly toolQuota = new WindowedQuota();

  /**
   * 检查用户直接输入。命中启发式规则时返回带 `hardenedSystemSuffix` 的结果，
   * 并写入 `injection_detected` 审计事件。
   */
  inspectUserInput(input: string, actor: string, traceId?: string): GuardResult {
    const verdict = inspectInput(input);
    if (verdict.flagged) {
      this.audit.logInjectionDetected(verdict.matched, input.length, actor, traceId);
    }
    return verdict;
  }

  /**
   * 检查外部内容（工具返回、检索片段、上传文档解析结果）。
   * 外部内容比用户输入更危险，因此使用更宽的规则集合。
   */
  inspectToolOutput(content: string, actor: string, traceId?: string): GuardResult {
    const verdict = inspectExternalContent(content);
    if (verdict.flagged) {
      this.audit.log({
        eventType: "injection_detected",
        severity: "critical",
        actor,
        target: "tool_output",
        outcome: "denied",
        details: {
          matchedPatterns: verdict.matched.join(","),
          contentLength: content.length,
        },
        traceId,
      });
    }
    return verdict;
  }

  /**
   * 把 `input-guard` 的判定结果落到**模型可见上下文**上。
   * 未命中时原样返回，避免给正常请求增加噪声。
   */
  hardenContext(verdict: GuardResult, context: string): string {
    if (!verdict.flagged) return context;
    return `${context}${verdict.hardenedSystemSuffix ?? HARDENED_SYSTEM_SUFFIX}`;
  }

  /** 紧急停止期间拒绝启动新的模型调用。 */
  assertAgentActive(): void {
    this.killSwitch.assertActive();
  }

  getStatus(): {
    killSwitch: ReturnType<KillSwitch["getStatus"]>;
    toolQuotaLimit: number;
    auditEvents: number;
  } {
    return {
      killSwitch: this.killSwitch.getStatus(),
      toolQuotaLimit: this.toolQuota.limit,
      auditEvents: this.audit.size,
    };
  }

  kill(reason: string): void {
    this.killSwitch.kill(reason);
    this.audit.log({
      eventType: "permission_denied",
      severity: "critical",
      actor: "admin",
      target: "kill_switch",
      outcome: "success",
      details: { action: "kill", reason },
    });
  }

  restore(): void {
    this.killSwitch.restore();
    this.audit.log({
      eventType: "permission_granted",
      severity: "warn",
      actor: "admin",
      target: "kill_switch",
      outcome: "success",
      details: { action: "restore" },
    });
  }

  /**
   * 工具调用的统一守卫：策略白名单 → 配额/超时 → 审计。
   *
   * 白名单是 **fail-closed** 的：未在 `tool-policy` 中登记的工具一律拒绝，
   * 而不是默认放行。写类/管理类工具额外记录 `requiresApproval` 标记，
   * 供上层审批流消费。
   */
  async guardToolCall<T>(
    context: ToolCallContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const policyName = stripToolPrefix(context.toolName);
    const level = classify(policyName);

    if (!isAllowed(policyName)) {
      this.audit.logToolInvocation(
        context.toolName,
        context.userId,
        "denied",
        { reason: "tool_not_allowed", level, intent: context.intent ?? "" },
        context.traceId,
      );
      throw new ToolPolicyDeniedError(context.toolName, level);
    }

    const quotaKey = context.conversationId ?? context.userId;
    try {
      const result = await withToolGuards(
        context.toolName,
        { conversationId: quotaKey, quota: this.toolQuota },
        fn,
        TOOL_TIMEOUT_MS,
      );
      this.audit.logToolInvocation(
        context.toolName,
        context.userId,
        "success",
        {
          level,
          requiresApproval: requiresApproval(policyName),
          conversationId: quotaKey,
        },
        context.traceId,
      );
      return result;
    } catch (error) {
      this.audit.logToolInvocation(
        context.toolName,
        context.userId,
        "error",
        {
          level,
          conversationId: quotaKey,
          error: error instanceof Error ? error.name : "unknown",
        },
        context.traceId,
      );
      throw error;
    }
  }
}

/** MCP 工具在暴露时会加 `req_` / `ws_` 前缀，策略表按未加前缀的名字登记。 */
export function stripToolPrefix(toolName: string): string {
  return toolName.replace(/^(?:req_|ws_)/u, "");
}

/** 生产链路共享的安全运行时单例。 */
export const securityRuntime = new SecurityRuntime();
