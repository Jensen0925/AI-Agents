import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";
import { getTraceId } from "./trace-context";

/**
 * 保持既有响应体透传，只确保非 Express 直写的响应也携带当前链路 ID。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const traceId = getTraceId();
    if (traceId) {
      response.setHeader("x-trace-id", traceId);
    }

    return next.handle();
  }
}
