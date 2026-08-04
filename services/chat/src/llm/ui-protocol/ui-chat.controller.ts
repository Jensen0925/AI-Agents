import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from "@nestjs/common";
import { uiActionSchema } from "./ui-schemas";
import { UiFlowService } from "./ui-flow.service";
import { UiResponseService } from "./ui-response.service";
import type { AIUIResponse, UIAction } from "./ui-types";

interface UiChatBody {
  sessionId?: unknown;
  input?: unknown;
  history?: unknown;
  context?: unknown;
}

interface UiActionBody {
  sessionId?: unknown;
  action?: unknown;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  return value.trim();
}

/** UI 协议的统一 HTTP 入口，前端只需要记住 chat/action 两个端点。 */
@Controller("api/ui-chat")
export class UiChatController {
  constructor(
    private readonly uiResponseService: UiResponseService,
    private readonly uiFlowService: UiFlowService,
  ) {}

  /** 根据自然语言生成一个或多个可渲染 UI 组件。 */
  @Post("chat")
  chat(@Body() rawBody: UiChatBody): Promise<AIUIResponse> {
    const body = rawBody ?? {};
    const sessionId = requireText(body.sessionId, "sessionId");
    const input = requireText(body.input, "input");

    // 新建需求是确定性的交互入口，先初始化 session context，再从 Stage 1 开始。
    // 其他自然语言仍交给 Structured Output 服务生成通用 UI 响应。
    if (/新建?一个新需求|提一个新需求|新需求/.test(input)) {
      return Promise.resolve(this.uiFlowService.start(sessionId, input));
    }

    return this.uiResponseService.generateUIResponse(
      input,
      body.history,
      body.context,
    );
  }

  /** 接收 selection/form/confirmation/button 回传，并推进 session 状态机。 */
  @Post("action")
  action(@Body() rawBody: UiActionBody): AIUIResponse {
    const body = rawBody ?? {};
    const sessionId = requireText(body.sessionId, "sessionId");
    const parsed = uiActionSchema.safeParse(body.action);

    if (!parsed.success) {
      throw new BadRequestException("action must be a valid UIAction");
    }

    return this.uiFlowService.handleAction(sessionId, parsed.data as UIAction);
  }
}
