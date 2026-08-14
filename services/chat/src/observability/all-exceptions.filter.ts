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
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof exceptionResponse === "object" &&
      exceptionResponse !== null &&
      "message" in exceptionResponse
        ? (exceptionResponse as { message: unknown }).message
        : exception instanceof Error
          ? exception.message
          : "Internal server error";
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
