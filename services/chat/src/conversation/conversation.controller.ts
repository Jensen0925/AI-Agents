import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  type AdvancedAnalysisResult,
  AdvancedAnalysisService,
} from "../llm/advanced-analysis.service";
import { MessageService } from "../message/message.service";
import { ConversationService } from "./conversation.service";

interface CreateConversationBody {
  title?: string;
}

interface ChatBody {
  input: string;
}

interface RenameConversationBody {
  title: string;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

@UseGuards(JwtAuthGuard)
@Controller("api/conversations")
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly advancedAnalysisService: AdvancedAnalysisService,
  ) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateConversationBody,
  ) {
    if (body?.title !== undefined && typeof body.title !== "string") {
      throw new BadRequestException("title must be a string");
    }

    return this.conversationService.create(
      currentUserId(request),
      body?.title,
    );
  }

  @Get()
  findByUser(@Req() request: AuthenticatedRequest) {
    return this.conversationService.findByUser(currentUserId(request));
  }

  @Get(":id/messages")
  async getMessages(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
    @Query("limit") rawLimit?: string,
  ) {
    const conversationId = requireText(rawConversationId, "id");
    await this.conversationService.findById(
      conversationId,
      currentUserId(request),
    );
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      throw new BadRequestException("limit must be a positive number");
    }

    return this.messageService.getHistory(conversationId, limit);
  }

  @Post(":id/chat")
  async chat(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
    @Body() body: ChatBody,
  ): Promise<AdvancedAnalysisResult> {
    const conversationId = requireText(rawConversationId, "id");
    const userId = currentUserId(request);
    await this.conversationService.findById(
      conversationId,
      userId,
    );
    return this.advancedAnalysisService.analyze(
      userId,
      conversationId,
      requireText(body?.input, "input"),
    );
  }

  @Patch(":id")
  rename(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
    @Body() body: RenameConversationBody,
  ) {
    return this.conversationService.rename(
      requireText(rawConversationId, "id"),
      currentUserId(request),
      requireText(body?.title, "title"),
    );
  }

  @Delete(":id")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
  ): Promise<{ ok: true; id: string }> {
    const conversationId = requireText(rawConversationId, "id");
    await this.conversationService.delete(
      conversationId,
      currentUserId(request),
    );
    return { ok: true, id: conversationId };
  }
}
