import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import { ArtifactService } from "./artifact.service";

function userIdOf(request: AuthenticatedRequest): string {
  if (!request.user?.userId) {
    throw new BadRequestException("Authenticated user is unavailable");
  }
  return request.user.userId;
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function versionOf(value: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException("version must be a positive integer");
  }
  return version;
}

@Controller("api/artifacts")
@UseGuards(JwtAuthGuard)
export class ArtifactController {
  constructor(private readonly artifactService: ArtifactService) {}

  @Get("conversation/:conversationId")
  findByConversation(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId") conversationId: string,
  ) {
    return this.artifactService.findByConversation(
      nonEmptyText(conversationId, "conversationId"),
      userIdOf(request),
    );
  }

  @Get(":id/versions")
  getVersions(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.artifactService.getVersions(nonEmptyText(id, "id"), userIdOf(request));
  }

  @Post(":id/revert/:version")
  revert(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("version") version: string,
  ) {
    return this.artifactService.revertToVersion(
      nonEmptyText(id, "id"),
      userIdOf(request),
      versionOf(version),
    );
  }

  @Post(":id/optimize")
  optimize(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { instruction?: unknown },
    @Res() response: Response,
  ) {
    return this.artifactService.optimizeArtifactStream(
      nonEmptyText(id, "id"),
      userIdOf(request),
      nonEmptyText(body?.instruction, "instruction"),
      response,
    );
  }

  @Get(":id")
  findById(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.artifactService.findById(nonEmptyText(id, "id"), userIdOf(request));
  }

  @Put(":id")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { content?: unknown; changelog?: unknown },
  ) {
    if (body?.changelog !== undefined && typeof body.changelog !== "string") {
      throw new BadRequestException("changelog must be a string");
    }
    return this.artifactService.updateArtifact(nonEmptyText(id, "id"), userIdOf(request), {
      content: nonEmptyText(body?.content, "content"),
      changelog: body?.changelog,
    });
  }

  @Patch(":id/title")
  updateTitle(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { title?: unknown },
  ) {
    return this.artifactService.updateTitle(
      nonEmptyText(id, "id"),
      userIdOf(request),
      nonEmptyText(body?.title, "title"),
    );
  }

  @Delete(":id")
  async remove(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    await this.artifactService.deleteArtifact(nonEmptyText(id, "id"), userIdOf(request));
    return { ok: true };
  }
}
