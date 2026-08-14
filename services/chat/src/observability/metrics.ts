import { Histogram, register } from "prom-client";

const HTTP_DURATION_METRIC_NAME = "http_request_duration_seconds";

const existingMetric = register.getSingleMetric(HTTP_DURATION_METRIC_NAME) as
  | Histogram<"method" | "route" | "statusCode">
  | undefined;

/** HTTP 请求总耗时（秒），由 TraceMiddleware 在响应完成时记录。 */
export const httpDuration =
  existingMetric ??
  new Histogram({
    name: HTTP_DURATION_METRIC_NAME,
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "statusCode"] as const,
  });
