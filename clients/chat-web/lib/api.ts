import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getSession, saveSession, type Session } from "./auth";

/**
 * 所有浏览器端 API 请求统一设置超时，避免后端未启动、代理不可达或数据库连接卡住时页面永久等待。
 */
export const api = axios.create({
  baseURL: "/api",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<Session | null> | null = null;

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const session = getSession();
  if (session?.accessToken && session.accessToken !== "demo") {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status;
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (status === 403 && typeof window !== "undefined") {
      window.location.assign("/forbidden");
      return Promise.reject(error);
    }
    if (status !== 401 || !original || original._retry || original.url?.includes("/auth/refresh")) {
      return Promise.reject(error);
    }
    const session = getSession();
    if (!session?.refreshToken || session.refreshToken === "demo") {
      clearSession();
      if (typeof window !== "undefined") window.location.assign("/login");
      return Promise.reject(error);
    }
    original._retry = true;
    refreshPromise ??= axios
      .post<Session>(
        "/api/auth/refresh",
        { refreshToken: session.refreshToken },
        { timeout: 10_000 },
      )
      .then(({ data }) => { saveSession(data); return data; })
      .catch(() => { clearSession(); if (typeof window !== "undefined") window.location.assign("/login"); return null; })
      .finally(() => { refreshPromise = null; });
    const refreshed = await refreshPromise;
    if (!refreshed) return Promise.reject(error);
    original.headers.Authorization = `Bearer ${refreshed.accessToken}`;
    return api(original);
  },
);

export function apiErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return "请求超时，请确认 Nest API（localhost:3001）和 PostgreSQL 正常运行";
    }
    if (!error.response) {
      return "无法连接 Nest API，请确认 localhost:3001 已启动";
    }
    return error.response.data?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}
