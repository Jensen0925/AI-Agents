import { UnauthorizedException } from "@nestjs/common";

export type SessionVerdict = "alive" | "revoked" | "skip";
export interface SessionStore { check(sessionId: string): Promise<SessionVerdict>; }
/** The current chat service can opt in to a database/HTTP session store without creating a cross-service dependency. */
export const noopSessionStore: SessionStore = { check: async () => "skip" };

export function verdictFromSession(session: { isActive: boolean; expiresAt: Date } | null, now = new Date()): SessionVerdict {
  return session?.isActive && session.expiresAt.getTime() > now.getTime() ? "alive" : "revoked";
}

export async function assertSessionAlive(store: SessionStore, sessionId?: string): Promise<void> {
  if (sessionId && await store.check(sessionId) === "revoked") throw new UnauthorizedException("会话已失效，请重新登录");
}
