import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createLogger } from "./logger";
import { httpDuration } from "./metrics";
import { getElapsedMs, getTraceId, newTraceId, runWithTrace } from "./trace-context";

const accessLog = createLogger("http.access");

/**
 * 把一次请求归一化成**低基数**的 metrics 路由标签。
 *
 * 直接用 `request.originalUrl`（`/api/documents/<uuid>?limit=20`）会让每个
 * 具体 URL 各自成为一条时间序列，Prometheus 的序列数随请求量无界增长。
 * 因此优先使用 Express 匹配到的路由模板（`/:id/raw`），未匹配到路由
 * （404、静态资源）时才退化为「抹掉疑似主键段的路径」。
 */
function resolveRouteLabel(request: Request): string {
  const template = (request.route as { path?: unknown } | undefined)?.path;
  if (typeof template === "string" && template.length > 0) {
    return `${request.baseUrl ?? ""}${template}` || template;
  }

  const path = (request.originalUrl ?? request.url).split("?")[0] ?? "/";
  return path
    .split("/")
    .map((segment) =>
      isLikelyIdentifier(segment) ? ":id" : segment,
    )
    .join("/");
}

/** UUID、雪花/自增数字、长十六进制串都视为路径主键。 */
function isLikelyIdentifier(segment: string): boolean {
  if (!segment) return false;
  if (/^\d+$/u.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(segment)) {
    return true;
  }
  return /^[0-9a-f]{16,}$/iu.test(segment);
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const headerTraceId = request.header("x-trace-id")?.trim();
    const traceId = headerTraceId || newTraceId();
    const startedAt = Date.now();

    response.setHeader("x-trace-id", traceId);

    runWithTrace(traceId, () => {
      response.on("finish", () => {
        const elapsedMs = getElapsedMs() ?? Date.now() - startedAt;
        // 路由模板只有在路由匹配完成后才可用，所以放到 finish 时再解析。
        const route = resolveRouteLabel(request);
        const labels = {
          method: request.method,
          route,
          statusCode: String(response.statusCode),
        };

        httpDuration.observe(labels, elapsedMs / 1_000);
        accessLog.info(
          {
            ...labels,
            // 日志保留完整路径便于排查，metrics 已改用上面的模板标签。
            path: request.originalUrl ?? request.url,
            elapsedMs,
            contentLength: response.getHeader("content-length"),
            traceId: getTraceId() ?? traceId,
          },
          "HTTP request completed",
        );
      });

      next();
    });
  }
}
