import { describe, expect, it, mock } from "bun:test";
import { MessageRole } from "@prisma/client";
import { ConversationController } from "../src/conversation/conversation.controller";
import type { ConversationService } from "../src/conversation/conversation.service";
import type { AdvancedAnalysisService } from "../src/llm/advanced-analysis.service";
import {
  UiFlowService,
  type UIFlowContext,
} from "../src/llm/ui-protocol/ui-flow.service";
import type { UiResponseService } from "../src/llm/ui-protocol/ui-response.service";
import type { AIUIResponse } from "../src/llm/ui-protocol/ui-types";
import type { MessageService } from "../src/message/message.service";

const FLOW_INPUT = "我要提一个新需求：用户希望能够批量导入 Excel 数据";

function componentTypes(response: AIUIResponse): string[] {
  return response.components.map((component) => component.type);
}

describe("UiFlowService", () => {
  it("按选择、填写、确认、结果四阶段推进需求分析流程", () => {
    const service = new UiFlowService();
    const sessionId = "flow-session-1";

    expect(componentTypes(service.start(sessionId, FLOW_INPUT))).toEqual([
      "selection",
    ]);

    expect(
      componentTypes(
        service.handleAction(sessionId, {
          type: "selection",
          componentId: "requirement-type",
          value: "functional",
        }),
      ),
    ).toEqual(["form"]);

    expect(
      componentTypes(
        service.handleAction(sessionId, {
          type: "form_submit",
          componentId: "requirement-detail",
          values: {
            title: "批量导入 Excel 数据",
            description: "用户希望能够批量导入 Excel 数据",
            priority: "P1",
            acceptanceCriteria: "支持导入、错误提示和结果统计",
          },
        }),
      ),
    ).toEqual(["confirmation", "card"]);

    expect(
      componentTypes(
        service.handleAction(sessionId, {
          type: "confirmation",
          componentId: "requirement-confirmation",
          confirmed: true,
          action: "confirm_analysis",
        }),
      ),
    ).toEqual(["steps", "action_buttons"]);
    expect(service.getContext(sessionId).sessionStage).toBe("result");
  });

  it("用 sessionId 隔离流程，且可从已持久化 context 恢复", () => {
    const first = new UiFlowService();
    const sessionA = "flow-session-a";
    const sessionB = "flow-session-b";
    first.start(sessionA, FLOW_INPUT);
    first.start(sessionB, "我要提一个新需求：优化登录流程");
    first.handleAction(sessionA, { type: "selection", value: "functional" });

    const savedContext = first.getContext(sessionA);
    expect(first.getContext(sessionB).sessionStage).toBe("select_type");

    const restored = new UiFlowService();
    expect(restored.restoreContext(sessionA, savedContext)).toBe(true);
    expect(
      componentTypes(
        restored.handleAction(sessionA, {
          type: "form_submit",
          values: {
            title: "批量导入",
            description: "导入 Excel",
            priority: "P1",
            acceptanceCriteria: "导入成功后显示统计",
          },
        }),
      ),
    ).toContain("confirmation");
    expect(restored.restoreContext(sessionB, { sessionStage: "unknown" })).toBe(
      false,
    );
  });
});

describe("ConversationController UI Chat", () => {
  it("将 UI 组件和流程上下文随会话消息持久化", async () => {
    const findById = mock(async () => ({ id: "conversation-1" }));
    const getHistory = mock(async () => []);
    const addMessage = mock(async () => ({ id: "message-1" }));
    const start = mock(() => ({
      message: "请选择需求类型。",
      components: [
        {
          type: "selection" as const,
          title: "选择需求类型",
          options: [{ label: "功能需求", value: "functional" }],
        },
      ],
    }));
    const getContext = mock(
      (): UIFlowContext => ({
        sessionStage: "select_type",
        collectedData: { initialInput: FLOW_INPUT },
      }),
    );
    const controller = new ConversationController(
      { findById } as unknown as ConversationService,
      { getHistory, addMessage } as unknown as MessageService,
      {} as AdvancedAnalysisService,
      {} as UiResponseService,
      {
        start,
        hasSession: mock(() => true),
        getContext,
      } as unknown as UiFlowService,
    );

    const response = await controller.uiChat(
      { headers: {}, user: { userId: "user-1" } },
      "conversation-1",
      { input: FLOW_INPUT },
    );

    expect(findById).toHaveBeenCalledWith("conversation-1", "user-1");
    expect(start).toHaveBeenCalledWith("conversation-1", FLOW_INPUT);
    expect(response.components[0]?.type).toBe("selection");
    expect(addMessage).toHaveBeenNthCalledWith(
      1,
      "conversation-1",
      MessageRole.USER,
      FLOW_INPUT,
    );
    expect(addMessage).toHaveBeenLastCalledWith(
      "conversation-1",
      MessageRole.ASSISTANT,
      "请选择需求类型。",
      expect.objectContaining({
        ui: expect.objectContaining({
          components: expect.any(Array),
          flowContext: expect.objectContaining({ sessionStage: "select_type" }),
        }),
      }),
    );
  });

  it("执行 UI action 前会从上一条助手消息恢复流程状态", async () => {
    const findById = mock(async () => ({ id: "conversation-1" }));
    const getHistory = mock(async () => [
      {
        role: MessageRole.ASSISTANT,
        metadata: {
          ui: {
            flowContext: {
              sessionStage: "fill_detail",
              collectedData: { requirementType: "functional" },
            },
          },
        },
      },
    ]);
    const addMessage = mock(async () => ({ id: "message-2" }));
    const restoreContext = mock(() => true);
    const handleAction = mock(() => ({
      message: "请确认提交。",
      components: [
        {
          type: "confirmation" as const,
          title: "确认提交",
          summary: "批量导入 Excel 数据",
        },
      ],
    }));
    const controller = new ConversationController(
      { findById } as unknown as ConversationService,
      { getHistory, addMessage } as unknown as MessageService,
      {} as AdvancedAnalysisService,
      {} as UiResponseService,
      {
        restoreContext,
        handleAction,
        hasSession: mock(() => true),
        getContext: mock(
          (): UIFlowContext => ({
            sessionStage: "confirm",
            collectedData: { requirementType: "functional" },
          }),
        ),
      } as unknown as UiFlowService,
    );

    // action body 由 { action } 包裹；这里验证 schema、恢复与持久化链路。
    await controller.uiAction(
      { headers: {}, user: { userId: "user-1" } },
      "conversation-1",
      { action: { type: "selection", value: "functional" } },
    );

    expect(restoreContext).toHaveBeenCalledWith("conversation-1", {
      sessionStage: "fill_detail",
      collectedData: { requirementType: "functional" },
    });
    expect(handleAction).toHaveBeenCalledWith("conversation-1", {
      type: "selection",
      value: "functional",
    });
    expect(addMessage).toHaveBeenCalledWith(
      "conversation-1",
      MessageRole.ASSISTANT,
      "请确认提交。",
      expect.any(Object),
    );
  });
});
