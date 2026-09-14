import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearSession, getSession, saveSession, type Session } from "./auth";

interface ApiErrorPayload {
  message?: string;
  traceId?: string;
}

declare module "axios" {
  export interface AxiosRequestConfig {
    /**
     * 该请求由后台/局部面板发起（工件面板、全局检索、附件预览等）。
     * 这类请求返回 403 时只应让局部功能降级，**不能**整页跳转到 /forbidden，
     * 否则会丢弃用户正在进行的分析。
     */
    skipAuthRedirect?: boolean;
  }
}

type RetryableConfig = InternalAxiosRequestConfig & {
  retry?: boolean;
  skipAuthRedirect?: boolean;
};

/**
 * 所有浏览器端 API 请求统一设置超时，避免后端未启动、代理不可达或数据库连接卡住时页面永久等待。
 */
export const api = axios.create({
  baseURL: "/api",
  // 完整需求分析包含多次模型调用，给后端 30 秒总时限留出网络余量。
  // 单个请求仍可通过 config.timeout 覆盖。
  timeout: 45_000,
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<Session | null> | null = null;

/**
 * 单飞（single-flight）刷新 access token。
 *
 * 多个并发 401 只会触发一次刷新；无法刷新时清空会话并跳转登录，返回 null。
 * 抽成导出函数是为了让**走不了 axios 拦截器的流式请求**（SSE / fetch reader）
 * 复用同一套去重与登出逻辑，而不是另起一套易漂移的刷新路径。
 */
export function refreshAccessTokenOnce(): Promise<Session | null> {
  const session = getSession();
  if (!session?.refreshToken || session.refreshToken === "demo") {
    clearSession();
    if (typeof window !== "undefined") window.location.assign("/login");
    return Promise.resolve(null);
  }

  refreshPromise ??= axios
    .post<Session>(
      "/api/auth/refresh",
      { refreshToken: session.refreshToken },
      { timeout: 10_000 },
    )
    .then(({ data }) => {
      saveSession(data);
      return data;
    })
    .catch(() => {
      clearSession();
      if (typeof window !== "undefined") window.location.assign("/login");
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const session = getSession();
  if (session?.accessToken && session.accessToken !== "demo") {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorPayload>) => {
    const status = error.response?.status;
    const original = error.config as RetryableConfig | undefined;
    // 只有导航级请求（页面首屏数据）才整页跳转；后台/局部请求用
    // `skipAuthRedirect: true` 自行降级，避免打断用户操作。
    if (status === 403 && typeof window !== "undefined") {
      if (!original?.skipAuthRedirect) {
        window.location.assign("/forbidden");
      }
      return Promise.reject(error);
    }
    if (status !== 401 || !original || original.retry || original.url?.includes("/auth/refresh")) {
      return Promise.reject(error);
    }

    original.retry = true;
    const refreshed = await refreshAccessTokenOnce();
    if (!refreshed) return Promise.reject(error);
    original.headers.Authorization = `Bearer ${refreshed.accessToken}`;
    return api(original);
  },
);

export function apiErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const axiosError = error as AxiosError<ApiErrorPayload>;
    if (axiosError.code === "ECONNABORTED" || axiosError.code === "ETIMEDOUT") {
      return "请求超时，请确认 Nest API（localhost:3001）和 PostgreSQL 正常运行";
    }
    if (!axiosError.response) {
      return "无法连接 Nest API，请确认 localhost:3001 已启动";
    }
    const message = axiosError.response.data?.message ?? axiosError.message;
    const traceId =
      axiosError.response.data?.traceId ??
      String(axiosError.response.headers["x-trace-id"] ?? "").trim();
    return traceId ? `${message}（追踪 ID：${traceId}）` : message;
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}
