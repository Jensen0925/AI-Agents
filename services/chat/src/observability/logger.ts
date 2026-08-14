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
    paths: [
      "apiKey",
      "authorization",
      "password",
      "*.apiKey",
      "*.authorization",
      "*.password",
      "req.headers.authorization",
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
