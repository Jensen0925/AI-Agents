import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TaskEvent } from "@prisma/client";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import { type PaginatedTaskEvents, SseService } from "./sse.service";

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

function requireTaskId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("taskId must be a non-empty string");
  }

  return value.trim();
}

function parsePageValue(
  value: string | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }

  return Math.min(maximum, parsed);
}

@UseGuards(JwtAuthGuard)
@Controller("api/tasks")
export class TaskEventController {
  constructor(private readonly sseService: SseService) {}

  @Get("history")
  history(
    @Req() request: AuthenticatedRequest,
    @Query("page") rawPage?: string,
    @Query("pageSize") rawPageSize?: string,
  ): Promise<PaginatedTaskEvents> {
    const page = parsePageValue(rawPage, 1, Number.MAX_SAFE_INTEGER, "page");
    const pageSize = parsePageValue(rawPageSize, 20, 100, "pageSize");
    return this.sseService.getHistory(
      currentUserId(request),
      page,
      pageSize,
    );
  }

  @Get(":taskId")
  findByTaskId(
    @Req() request: AuthenticatedRequest,
    @Param("taskId") rawTaskId: string,
  ): Promise<TaskEvent[]> {
    return this.sseService.findByTaskId(
      currentUserId(request),
      requireTaskId(rawTaskId),
    );
  }

  @Patch(":taskId/read")
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param("taskId") rawTaskId: string,
  ): Promise<{ taskId: string; updated: number; readAt: Date }> {
    return this.sseService.markTaskRead(
      currentUserId(request),
      requireTaskId(rawTaskId),
    );
  }
}
