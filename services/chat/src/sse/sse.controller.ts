import {
  BadRequestException,
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import { SseService } from "./sse.service";

const HEARTBEAT_INTERVAL_MS = 25_000;

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

@UseGuards(JwtAuthGuard)
@Controller("api/sse")
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Get("tasks")
  connect(
    @Req() request: Request & AuthenticatedRequest,
    @Res() response: Response,
  ): void {
    const userId = currentUserId(request);
    response.status(200);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write("retry: 5000\n\n");
    this.sseService.addConnection(userId, response);

    let cleaned = false;
    let heartbeat: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      this.sseService.removeConnection(userId, response);
    };

    heartbeat = setInterval(() => {
      if (response.destroyed || response.writableEnded) {
        cleanup();
        return;
      }

      try {
        response.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    request.once("close", cleanup);
    response.once("close", cleanup);
  }
}
