export type TrustLevel = "system" | "developer" | "user" | "agent" | "tool_output" | "external";
const trustOrder: TrustLevel[] = ["external", "tool_output", "agent", "user", "developer", "system"];
export interface TrustBoundary { id: string; from: TrustLevel; to: TrustLevel; description: string; }
export const trustScore = (level: TrustLevel): number => trustOrder.indexOf(level);
export const crossesTrustBoundary = (from: TrustLevel, to: TrustLevel): boolean => trustScore(from) < trustScore(to);
export const canAlterAgentBehavior = (level: TrustLevel): boolean => level === "system" || level === "developer";
export const canIssueTask = (level: TrustLevel): boolean => ["system", "developer", "user"].includes(level);

export interface InvariantContext { action: string; actor: string; resource?: string; target?: string; dataContent?: string; [key: string]: unknown; }
export interface SecurityInvariant { id: string; description: string; check(context: InvariantContext): boolean; }
export class InvariantViolation extends Error { constructor(public readonly invariantId: string, public readonly context: InvariantContext) { super(`安全不变量违反：${invariantId}（action=${context.action}, actor=${context.actor}）`); this.name = "InvariantViolation"; } }
export const AGENT_INVARIANTS: SecurityInvariant[] = [
  { id: "no-agent-admin-creation", description: "Agent 不允许创建管理员账户", check: (context) => !(context.action === "create_admin" && context.actor.startsWith("agent")) },
  { id: "no-pii-to-external", description: "PII 不允许发送到外部网络", check: (context) => !(context.action === "send_external" && context.dataContent?.includes("@")) },
  { id: "no-production-delete-by-agent", description: "生产数据库不能被 Agent 删除", check: (context) => !(context.action === "delete" && context.resource === "production_database" && context.actor.startsWith("agent")) },
  { id: "no-secret-in-response", description: "密钥不能出现在对外响应", check: (context) => context.action !== "respond" || !context.dataContent || !/(?:sk|pk|api[_-]?key)[_-][\w]{16,}/i.test(context.dataContent) },
];
export class InvariantChecker {
  constructor(private readonly invariants: SecurityInvariant[] = AGENT_INVARIANTS) {}
  check(context: InvariantContext): { passed: boolean; violations: string[] } { const violations = this.invariants.filter((invariant) => !invariant.check(context)).map((invariant) => invariant.id); return { passed: violations.length === 0, violations }; }
  assert(context: InvariantContext): void { const result = this.check(context); if (!result.passed) throw new InvariantViolation(result.violations[0], context); }
  list(): Array<{ id: string; description: string }> { return this.invariants.map(({ id, description }) => ({ id, description })); }
}
export async function failClosed<T>(check: () => Promise<T> | T, fallback: "deny" | "allow" = "deny"): Promise<{ ok: boolean; result?: T; error?: Error }> { try { return { ok: true, result: await check() }; } catch (error) { return fallback === "allow" ? { ok: true } : { ok: false, error: error instanceof Error ? error : new Error(String(error)) }; } }
export function failClosedSync<T>(check: () => T): { ok: boolean; result?: T; error?: Error } { try { return { ok: true, result: check() }; } catch (error) { return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }; } }
export type ThreatCategory = "injection" | "privilege_escalation" | "data_leak" | "denial_of_service" | "denial_of_wallet" | "context_poisoning" | "supply_chain";
export interface ThreatScenario { id: string; category: ThreatCategory; asset: string; attacker: string; attackPath: string; mitigation: string; }
export const AGENT_THREAT_SCENARIOS: ThreatScenario[] = [
  { id: "direct-injection", category: "injection", asset: "系统指令完整性", attacker: "恶意用户", attackPath: "用户输入覆盖指令", mitigation: "输入检测与边界强化" },
  { id: "indirect-injection", category: "injection", asset: "系统指令完整性", attacker: "第三方内容（网页/邮件/PDF）", attackPath: "外部内容隐藏指令", mitigation: "信任边界与输入检测" },
  { id: "agent-privilege-escalation", category: "privilege_escalation", asset: "数据库、文件系统", attacker: "被注入的 Agent", attackPath: "跨 Agent 越权", mitigation: "最小权限与能力令牌" },
  { id: "data-exfiltration", category: "data_leak", asset: "用户 PII / API Key", attacker: "恶意网页内容", attackPath: "读取后外传", mitigation: "DataFlowGuard" },
  { id: "denial-of-wallet", category: "denial_of_wallet", asset: "运营预算", attacker: "恶意用户或 Agent", attackPath: "反复调用昂贵工具", mitigation: "配额和成本控制" },
  { id: "context-poisoning", category: "context_poisoning", asset: "长期记忆 / RAG", attacker: "恶意内容写入者", attackPath: "污染知识库", mitigation: "写入审核与来源标记" },
  { id: "supply-chain-attack", category: "supply_chain", asset: "工具链完整性", attacker: "恶意 MCP Server / Plugin", attackPath: "替换可信工具", mitigation: "工具白名单与签名验证" },
];
