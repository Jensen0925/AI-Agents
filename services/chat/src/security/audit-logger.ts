export type AuditSeverity = "info" | "warn" | "critical";
export type AuditEventType = "tool_invoked" | "tool_blocked" | "permission_denied" | "permission_granted" | "injection_detected" | "session_revoked" | "human_approved" | "human_rejected" | "sandbox_execution" | "data_access" | "secret_accessed" | "path_escape_blocked";
export interface AuditEvent {
  timestamp: string; eventType: AuditEventType; severity: AuditSeverity; actor: string; target: string;
  outcome: "success" | "denied" | "error"; details: Record<string, string | number | boolean>; traceId?: string;
}
export interface AuditQuery { eventType?: AuditEventType; severity?: AuditSeverity; actor?: string; outcome?: AuditEvent["outcome"]; since?: Date; until?: Date; limit?: number; }

/** In-memory append-only adapter. Supply the callback to forward events to a persistent audit sink. */
export class AuditLogger {
  private readonly events: AuditEvent[] = [];
  constructor(private readonly onEvent?: (event: AuditEvent) => void) {}
  log(event: Omit<AuditEvent, "timestamp"> & { timestamp?: string }): AuditEvent {
    const full = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
    this.events.push(full); this.onEvent?.(full); return full;
  }
  logToolInvocation(toolName: string, actor: string, outcome: AuditEvent["outcome"], details: AuditEvent["details"] = {}, traceId?: string): AuditEvent {
    return this.log({ eventType: outcome === "denied" ? "tool_blocked" : "tool_invoked", severity: outcome === "denied" ? "warn" : "info", actor, target: toolName, outcome, details, traceId });
  }
  logInjectionDetected(matchedPatterns: string[], inputLength: number, actor: string, traceId?: string): AuditEvent {
    return this.log({ eventType: "injection_detected", severity: "critical", actor, target: "user_input", outcome: "denied", details: { matchedPatterns: matchedPatterns.join(","), inputLength }, traceId });
  }
  logHumanDecision(toolName: string, approver: string, approved: boolean, traceId?: string): AuditEvent {
    return this.log({ eventType: approved ? "human_approved" : "human_rejected", severity: "info", actor: approver, target: toolName, outcome: approved ? "success" : "denied", details: { decision: approved ? "approve" : "reject" }, traceId });
  }
  logSandboxExecution(command: string, exitCode: number, durationMs: number, actor: string, traceId?: string): AuditEvent {
    return this.log({ eventType: "sandbox_execution", severity: exitCode === 0 ? "info" : "warn", actor, target: command, outcome: exitCode === 0 ? "success" : "error", details: { exitCode, durationMs }, traceId });
  }
  query(query: AuditQuery = {}): AuditEvent[] {
    const result = this.events.filter((event) => (!query.eventType || event.eventType === query.eventType) && (!query.severity || event.severity === query.severity) && (!query.actor || event.actor === query.actor) && (!query.outcome || event.outcome === query.outcome) && (!query.since || event.timestamp >= query.since.toISOString()) && (!query.until || event.timestamp <= query.until.toISOString())).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return query.limit ? result.slice(0, query.limit) : result;
  }
  countByType(): Record<string, number> { return this.events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.eventType]: (counts[event.eventType] ?? 0) + 1 }), {}); }
  get size(): number { return this.events.length; }
}
