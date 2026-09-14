import {
  DEMO_SESSION_PERMISSIONS,
  SESSION_STORAGE_KEYS,
} from "@cloudsage/contracts/session";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

// chat-web 与 admin-web 可能同域部署，localStorage 按 origin 共享，
// 因此键名必须带应用前缀，否则两个应用会互相覆盖会话。
const { session: SESSION_KEY, demo: DEMO_KEY } = SESSION_STORAGE_KEYS.chatWeb;

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.localStorage.removeItem(DEMO_KEY);
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(DEMO_KEY);
}

export function saveDemoSession(): void {
  const user: SessionUser = {
    id: "demo-admin",
    email: "admin@cloudsage.local",
    name: "系统管理员",
    roles: ["super_admin"],
    permissions: [...DEMO_SESSION_PERMISSIONS],
  };
  window.localStorage.setItem(DEMO_KEY, "true");
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: "demo", refreshToken: "demo", expiresIn: 3600, user } satisfies Session));
}

export function isDemoSession(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(DEMO_KEY) === "true";
}

export function getCurrentUser(): SessionUser | null {
  return getSession()?.user ?? null;
}
