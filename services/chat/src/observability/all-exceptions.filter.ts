import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createLogger } from "./logger";
import { getTraceId } from "./trace-context";

const errorLog = createLogger("http.exception");

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // 只有 HttpException 的 message 是「有意写给客户端看的」。
    // 其余（PG 报错、库内部异常、JWT 验签细节等）一律收敛为通用文案，
    // 详情只进服务端日志——traceId 已足以把用户报错与日志关联起来。
    let message: unknown = "Internal server error";
    if (isHttpException) {
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === "object" &&
        exceptionResponse !== null &&
        "message" in exceptionResponse
          ? (exceptionResponse as { message: unknown }).message
          : exception.message;
    }
    const traceId = getTraceId();

    errorLog.error(
      {
        err: exception,
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: status,
        traceId,
      },
      "HTTP request failed",
    );

    response.status(status).json({
      statusCode: status,
      message,
      traceId,
    });
  }
}
