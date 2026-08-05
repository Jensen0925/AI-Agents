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
import { MessageRole, type Prisma } from "@prisma/client";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  type AdvancedAnalysisResult,
  AdvancedAnalysisService,
} from "../llm/advanced-analysis.service";
import { UiFlowService, type UIFlowContext } from "../llm/ui-protocol/ui-flow.service";
import { UiResponseService } from "../llm/ui-protocol/ui-response.service";
import { uiActionSchema } from "../llm/ui-protocol/ui-schemas";
import type { AIUIResponse, UIAction } from "../llm/ui-protocol/ui-types";
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

interface UiChatBody {
  input: unknown;
}

interface UiActionBody {
  action: unknown;
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

function isUiFlowStart(input: string): boolean {
  return /新建?一个新需求|提一个新需求|新需求/.test(input);
}

function uiResponseText(response: AIUIResponse): string {
  if (response.message?.trim()) {
    return response.message.trim();
  }

  const text = response.components
    .filter((component) => component.type === "text")
    .map((component) => component.content.trim())
    .filter(Boolean)
    .join("\n\n");

  return text || "请根据下方内容继续操作。";
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function flowContextFromMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const ui = (metadata as { ui?: unknown }).ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    return undefined;
  }

  return (ui as { flowContext?: unknown }).flowContext;
}

@Controller("api/conversations")
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly advancedAnalysisService: AdvancedAnalysisService,
    private readonly uiResponseService: UiResponseService,
    private readonly uiFlowService: UiFlowService,
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

  /**
   * 会话级 AI UI 入口。
   *
   * 该路由复用普通聊天的会话权限与消息存储：UI 组件以及流程上下文写进
   * ASSISTANT 消息 metadata，前端在刷新或切换会话后仍能原样恢复组件。
   */
  @Post(":id/ui-chat")
  async uiChat(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
    @Body() body: UiChatBody,
  ): Promise<AIUIResponse> {
    const conversationId = requireText(rawConversationId, "id");
    const userId = currentUserId(request);
    const input = requireText(body?.input, "input");
    await this.conversationService.findById(conversationId, userId);

    // 先读取旧历史，再写入当前用户消息，避免在 Prompt 中把当前输入重复两次。
    const history = await this.messageService.getHistory(conversationId, 80);
    await this.messageService.addMessage(conversationId, MessageRole.USER, input);

    const response = isUiFlowStart(input)
      ? this.uiFlowService.start(conversationId, input)
      : await this.uiResponseService.generateUIResponse(input, history);

    await this.persistUiResponse(conversationId, response);
    return response;
  }

  /**
   * 推进当前会话的 UI 状态机。
   *
   * UiFlowService 为内存实现，因此先从上一条 UI 消息的 metadata 恢复上下文，
   * 以支持刷新页面、切换会话和服务重启后的后续 selection/form/confirmation 操作。
   */
  @Post(":id/ui-action")
  async uiAction(
    @Req() request: AuthenticatedRequest,
    @Param("id") rawConversationId: string,
    @Body() body: UiActionBody,
  ): Promise<AIUIResponse> {
    const conversationId = requireText(rawConversationId, "id");
    const userId = currentUserId(request);
    const parsed = uiActionSchema.safeParse(body?.action);
    if (!parsed.success) {
      throw new BadRequestException("action must be a valid UIAction");
    }

    await this.conversationService.findById(conversationId, userId);
    await this.restoreUiFlowContext(conversationId);
    const response = this.uiFlowService.handleAction(
      conversationId,
      parsed.data as UIAction,
    );
    await this.persistUiResponse(conversationId, response);
    return response;
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
    this.uiFlowService.clearSession(conversationId);
    return { ok: true, id: conversationId };
  }

  private async restoreUiFlowContext(conversationId: string): Promise<void> {
    const history = await this.messageService.getHistory(conversationId, 80);
    for (const message of [...history].reverse()) {
      if (message.role !== MessageRole.ASSISTANT) {
        continue;
      }

      const flowContext = flowContextFromMetadata(message.metadata);
      if (flowContext && this.uiFlowService.restoreContext(conversationId, flowContext)) {
        return;
      }
    }
  }

  private async persistUiResponse(
    conversationId: string,
    response: AIUIResponse,
  ): Promise<void> {
    const flowContext: UIFlowContext | undefined = this.uiFlowService.hasSession(
      conversationId,
    )
      ? this.uiFlowService.getContext(conversationId)
      : undefined;

    await this.messageService.addMessage(
      conversationId,
      MessageRole.ASSISTANT,
      uiResponseText(response),
      toJson({
        ui: {
          components: response.components,
          ...(flowContext ? { flowContext } : {}),
        },
      }),
    );
  }
}
