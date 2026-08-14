import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createLogger } from "./logger";
import { httpDuration } from "./metrics";
import { getElapsedMs, getTraceId, newTraceId, runWithTrace } from "./trace-context";

const accessLog = createLogger("http.access");

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const headerTraceId = request.header("x-trace-id")?.trim();
    const traceId = headerTraceId || newTraceId();
    const startedAt = Date.now();
    const route = request.originalUrl ?? request.url;

    response.setHeader("x-trace-id", traceId);

    runWithTrace(traceId, () => {
      response.on("finish", () => {
        const elapsedMs = getElapsedMs() ?? Date.now() - startedAt;
        const labels = {
          method: request.method,
          route,
          statusCode: String(response.statusCode),
        };

        httpDuration.observe(labels, elapsedMs / 1_000);
        accessLog.info(
          {
            ...labels,
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
