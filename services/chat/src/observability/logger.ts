import pino, { type Logger } from "pino";
import { getTraceId } from "./trace-context";

const REDACTED_VALUE = "[REDACTED]";

export function traceMixin(): Record<string, string> {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  mixin: traceMixin,
  redact: {
    // 除请求级的凭据外，还要覆盖会出现在业务对象里的**派生凭据**：
    // 密码哈希（可离线爆破）、refresh token 哈希（可用于会话固定）、
    // 明文 refresh/access token、以及任意名为 secret/apiKey 的字段。
    paths: [
      "apiKey",
      "authorization",
      "cookie",
      "password",
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "secret",
      "*.apiKey",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.passwordHash",
      "*.tokenHash",
      "*.refreshToken",
      "*.accessToken",
      "*.secret",
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
    ],
    censor: REDACTED_VALUE,
  },
  ...(process.env.LOG_PRETTY === "1"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});

export function createLogger(module: string): Logger {
  return logger.child({ module });
}
