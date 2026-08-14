export type KillSwitchState = "active" | "killed";
export class KillSwitchEngagedError extends Error { constructor(public readonly reason: string) { super(`Agent 已被紧急停止：${reason}`); this.name = "KillSwitchEngagedError"; } }
export class KillSwitch {
  private state: KillSwitchState = "active"; private killedAt?: string; private reason?: string;
  isActive(): boolean { return this.state === "active"; }
  kill(reason: string): void { this.state = "killed"; this.reason = reason; this.killedAt = new Date().toISOString(); }
  restore(): void { this.state = "active"; this.reason = undefined; this.killedAt = undefined; }
  getStatus(): { state: KillSwitchState; killedAt?: string; reason?: string } { return { state: this.state, killedAt: this.killedAt, reason: this.reason }; }
  assertActive(): void { if (!this.isActive()) throw new KillSwitchEngagedError(this.reason ?? "unknown"); }
}
export interface ActionSnapshot { id: string; timestamp: string; agentId: string; action: string; target: string; params: Record<string, unknown>; reversible: boolean; compensationAction?: string; }
export class ActionLog {
  private readonly snapshots: ActionSnapshot[] = [];
  record(snapshot: Omit<ActionSnapshot, "id" | "timestamp">): ActionSnapshot { const full = { ...snapshot, id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() }; this.snapshots.push(full); return full; }
  getReversible(): ActionSnapshot[] { return this.snapshots.filter((snapshot) => snapshot.reversible).slice().reverse(); }
  getByAgent(agentId: string): ActionSnapshot[] { return this.snapshots.filter((snapshot) => snapshot.agentId === agentId); }
  get size(): number { return this.snapshots.length; }
}
export type ApprovalStrategy = "auto_approve" | "single_approval" | "dual_approval" | "deny";
export interface RiskBasedApprovalRule { toolPattern: string | RegExp; strategy: ApprovalStrategy; }
const defaultRules: RiskBasedApprovalRule[] = [ { toolPattern: /^(analyze|estimate|search|web_search)/, strategy: "auto_approve" }, { toolPattern: /^(save|create|update)/, strategy: "single_approval" }, { toolPattern: /^(delete|drop|remove)/, strategy: "dual_approval" }, { toolPattern: /^(pay|transfer|wire)/, strategy: "deny" } ];
export class RiskBasedApproval {
  constructor(private readonly rules: RiskBasedApprovalRule[] = defaultRules) {}
  getStrategy(toolName: string): ApprovalStrategy { return this.rules.find((rule) => typeof rule.toolPattern === "string" ? rule.toolPattern === toolName : rule.toolPattern.test(toolName))?.strategy ?? "single_approval"; }
  requiresHuman(toolName: string): boolean { return ["single_approval", "dual_approval"].includes(this.getStrategy(toolName)); }
  isDenied(toolName: string): boolean { return this.getStrategy(toolName) === "deny"; }
}
