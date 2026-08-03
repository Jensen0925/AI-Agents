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

const SESSION_KEY = "cloudsage.session";
const DEMO_KEY = "cloudsage.demo";

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
    permissions: ["users:read", "users:create", "users:update", "users:delete", "roles:read", "roles:create", "roles:update", "roles:delete", "permissions:read", "profile:read", "profile:update"],
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
