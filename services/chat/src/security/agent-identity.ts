import { createHash, randomUUID } from "node:crypto";

export interface AgentIdentity { id: string; role: string; owner: string; createdAt: string; metadata?: Record<string, string>; }
export class AgentRegistry {
  private readonly agents = new Map<string, AgentIdentity>();
  register(identity: AgentIdentity): void { this.agents.set(identity.id, identity); }
  lookup(agentId: string): AgentIdentity | undefined { return this.agents.get(agentId); }
  unregister(agentId: string): boolean { return this.agents.delete(agentId); }
  listByOwner(owner: string): AgentIdentity[] { return [...this.agents.values()].filter((agent) => agent.owner === owner); }
  get size(): number { return this.agents.size; }
}

export interface CapabilityToken { id: string; agentId: string; capability: string; scope: string; maxOperations: number; usedOperations: number; destructive: boolean; issuedAt: string; expiresAt: string; revoked: boolean; }
export class CapabilityExpiredError extends Error { constructor(public readonly tokenId: string) { super(`Capability 已过期：${tokenId}`); this.name = "CapabilityExpiredError"; } }
export class CapabilityRevokedError extends Error { constructor(public readonly tokenId: string) { super(`Capability 已撤销：${tokenId}`); this.name = "CapabilityRevokedError"; } }
export class CapabilityExhaustedError extends Error { constructor(public readonly tokenId: string) { super(`Capability 已用尽：${tokenId}`); this.name = "CapabilityExhaustedError"; } }
export class CapabilityScopeError extends Error { constructor(public readonly tokenId: string, public readonly requestedPath: string) { super(`操作超出 Capability 范围：${requestedPath}（token=${tokenId}）`); this.name = "CapabilityScopeError"; } }

export class CapabilityManager {
  private readonly tokens = new Map<string, CapabilityToken>();
  issue(params: { agentId: string; capability: string; scope: string; maxOperations?: number; ttlMs?: number; destructive?: boolean }): CapabilityToken {
    const now = Date.now(); const token: CapabilityToken = { id: randomUUID(), agentId: params.agentId, capability: params.capability, scope: params.scope, maxOperations: params.maxOperations ?? 100, usedOperations: 0, destructive: params.destructive ?? false, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + (params.ttlMs ?? 600_000)).toISOString(), revoked: false };
    this.tokens.set(token.id, token); return token;
  }
  consume(tokenId: string, operationPath?: string): void {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) throw new CapabilityRevokedError(tokenId);
    if (Date.parse(token.expiresAt) <= Date.now()) throw new CapabilityExpiredError(tokenId);
    if (token.usedOperations >= token.maxOperations) throw new CapabilityExhaustedError(tokenId);
    if (operationPath && !operationPath.startsWith(token.scope)) throw new CapabilityScopeError(tokenId, operationPath);
    token.usedOperations += 1;
  }
  revoke(tokenId: string): boolean { const token = this.tokens.get(tokenId); if (!token) return false; token.revoked = true; return true; }
  listActive(agentId: string): CapabilityToken[] { const now = Date.now(); return [...this.tokens.values()].filter((token) => token.agentId === agentId && !token.revoked && Date.parse(token.expiresAt) > now && token.usedOperations < token.maxOperations); }
  revokeAll(agentId: string): number { let count = 0; this.tokens.forEach((token) => { if (token.agentId === agentId && !token.revoked) { token.revoked = true; count += 1; } }); return count; }
}

export function hashReasoning(reasoning: string): string { return createHash("sha256").update(reasoning).digest("hex").slice(0, 16); }
export function hashToolArgs(args: Record<string, unknown>): string { const ordered = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))); return hashReasoning(JSON.stringify(ordered)); }
