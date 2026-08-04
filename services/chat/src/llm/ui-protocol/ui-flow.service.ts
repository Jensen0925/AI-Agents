import { Injectable } from "@nestjs/common";
import type { AIUIResponse, UIAction } from "./ui-types";

/** 需求分析 UI 流程的四个业务阶段。 */
export type UIFlowStage = "select_type" | "fill_detail" | "confirm" | "result";

/** 每个 session 都有独立的上下文，前端可据此恢复当前 UI。 */
export interface UIFlowContext {
  sessionStage: UIFlowStage;
  collectedData: Record<string, unknown>;
}

interface FlowState {
  context: UIFlowContext;
}

const requirementTypeOptions = [
  { label: "功能需求", value: "functional", description: "新增或改造业务功能" },
  { label: "技术需求", value: "technical", description: "架构、性能或工程改进" },
  { label: "缺陷修复", value: "bugfix", description: "修复已知问题或回归缺陷" },
  { label: "数据需求", value: "data", description: "报表、指标或数据处理" },
];

function createInitialContext(input?: string): UIFlowContext {
  return {
    sessionStage: "select_type",
    collectedData: input?.trim() ? { initialInput: input.trim() } : {},
  };
}

function selectionResponse(): AIUIResponse {
  return {
    message: "请选择需求类型。",
    components: [
      {
        type: "selection",
        id: "requirement-type",
        title: "选择需求类型",
        description: "选择后继续填写需求详情。",
        multiple: false,
        required: true,
        submitLabel: "下一步",
        options: requirementTypeOptions,
      },
    ],
  };
}

function detailFormResponse(context: UIFlowContext): AIUIResponse {
  const requirementType = String(context.collectedData.requirementType ?? "未选择");
  const initialInput = String(context.collectedData.initialInput ?? "");

  return {
    message: "请填写需求详情，提交后进入确认阶段。",
    components: [
      {
        type: "form",
        id: "requirement-details",
        title: "填写需求详情",
        description: `需求类型：${requirementType}`,
        submitLabel: "提交需求分析",
        cancelLabel: "返回选择类型",
        fields: [
          {
            name: "title",
            label: "需求标题",
            type: "input",
            required: true,
            placeholder: "例如：批量导入 Excel 数据",
          },
          {
            name: "description",
            label: "需求描述",
            type: "textarea",
            required: true,
            defaultValue: initialInput,
            placeholder: "描述目标用户、业务范围和期望结果",
          },
          {
            name: "priority",
            label: "优先级",
            type: "select",
            required: true,
            options: [
              { label: "P0 - 紧急", value: "P0" },
              { label: "P1 - 高", value: "P1" },
              { label: "P2 - 中", value: "P2" },
              { label: "P3 - 低", value: "P3" },
            ],
          },
          {
            name: "acceptanceCriteria",
            label: "验收标准",
            type: "textarea",
            required: true,
            placeholder: "每条标准一行，描述可验证的完成条件",
          },
        ],
      },
    ],
  };
}

function confirmationResponse(context: UIFlowContext): AIUIResponse {
  const data = context.collectedData;
  const requirementType = String(data.requirementType ?? "未选择");
  const title = String(data.title ?? "未填写");
  const description = String(data.description ?? data.initialInput ?? "未填写");
  const priority = String(data.priority ?? "未设置");
  const acceptanceCriteria = String(data.acceptanceCriteria ?? "未填写");

  return {
    message: "请确认以下需求信息，确认后开始分析。",
    components: [
      {
        type: "confirmation",
        id: "requirement-confirmation",
        title: "确认提交需求分析",
        summary: [
          `需求类型：${requirementType}`,
          `需求标题：${title}`,
          `优先级：${priority}`,
          "确认后将生成需求分析报告。",
        ],
        confirmLabel: "确认提交",
        cancelLabel: "返回修改",
        confirmAction: "confirm_analysis",
        cancelAction: "edit_requirement",
      },
      {
        type: "card",
        id: "requirement-summary",
        title: title === "未填写" ? "需求摘要" : title,
        subtitle: "提交前信息预览",
        status: "待确认",
        fields: [
          { key: "requirementType", label: "需求类型", value: requirementType },
          { key: "title", label: "标题", value: title },
          { key: "description", label: "描述", value: description },
          { key: "priority", label: "优先级", value: priority },
          { key: "acceptanceCriteria", label: "验收标准", value: acceptanceCriteria },
        ],
        actions: [
          { label: "编辑需求", action: "edit_requirement", variant: "secondary" },
        ],
      },
    ],
  };
}

function resultResponse(): AIUIResponse {
  return {
    message: "需求分析已提交，以下是处理进度。",
    components: [
      {
        type: "steps",
        id: "requirement-analysis-steps",
        title: "需求分析流程",
        current: 1,
        steps: [
          { key: "extract", label: "抽取需求", status: "completed" },
          { key: "analysis", label: "多维分析", status: "current" },
          { key: "risk", label: "风险评估", status: "pending" },
          { key: "summary", label: "生成报告", status: "pending" },
        ],
      },
      {
        type: "action_buttons",
        id: "analysis-actions",
        title: "后续操作",
        buttons: [
          { label: "查看分析报告", action: "view_report", variant: "default" },
          { label: "新建需求", action: "new_requirement", variant: "secondary" },
        ],
      },
    ],
  };
}

function normalizeSelection(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

function actionError(message: string, response: AIUIResponse): AIUIResponse {
  return {
    message,
    components: [
      {
        type: "text",
        content: response.message ?? "当前操作不符合流程阶段。",
        markdown: false,
      },
      ...response.components,
    ],
  };
}

/**
 * 需求分析 UI 交互状态机。
 *
 * sessionId 是状态隔离边界：每个会话拥有自己的 sessionStage 与 collectedData，
 * 不会把一个会话的需求类型或表单内容带到另一个会话中。
 */
@Injectable()
export class UiFlowService {
  private readonly flowStates = new Map<string, FlowState>();

  private getOrCreateState(sessionId: string): FlowState {
    const current = this.flowStates.get(sessionId);
    if (current) {
      return current;
    }

    const state: FlowState = { context: createInitialContext() };
    this.flowStates.set(sessionId, state);
    return state;
  }

  /** 开始一次新的需求分析交互，将首句记录到 collectedData，并返回 Stage 1。 */
  start(sessionId: string, input?: string): AIUIResponse {
    const state: FlowState = {
      context: createInitialContext(input),
    };
    this.flowStates.set(sessionId, state);
    return selectionResponse();
  }

  /** 返回当前会话上下文，便于调试或前端恢复 UI。 */
  getContext(sessionId: string): UIFlowContext {
    const context = this.getOrCreateState(sessionId).context;
    return {
      sessionStage: context.sessionStage,
      collectedData: { ...context.collectedData },
    };
  }

  /** 由 Controller 统一调用，根据当前阶段和 UIAction 推进下一阶段。 */
  handleAction(sessionId: string, action: UIAction): AIUIResponse {
    const state = this.getOrCreateState(sessionId);
    const { context } = state;

    switch (action.type) {
      case "selection":
        return this.handleSelection(context, action.value);
      case "form_submit":
        return this.handleFormSubmit(context, action.values);
      case "confirmation":
        return this.handleConfirmation(context, action.confirmed);
      case "button":
        return this.handleButton(context, action.action);
    }
  }

  private handleSelection(
    context: UIFlowContext,
    value: string | string[],
  ): AIUIResponse {
    if (context.sessionStage !== "select_type") {
      return actionError("当前不在需求类型选择阶段。", this.responseForContext(context));
    }

    context.collectedData.requirementType = normalizeSelection(value);
    context.sessionStage = "fill_detail";
    return detailFormResponse(context);
  }

  private handleFormSubmit(
    context: UIFlowContext,
    values: Record<string, string | number | boolean | null>,
  ): AIUIResponse {
    if (context.sessionStage !== "fill_detail") {
      return actionError("当前不在需求详情填写阶段。", this.responseForContext(context));
    }

    context.collectedData = {
      ...context.collectedData,
      ...values,
    };
    context.sessionStage = "confirm";
    return confirmationResponse(context);
  }

  private handleConfirmation(
    context: UIFlowContext,
    confirmed: boolean,
  ): AIUIResponse {
    if (context.sessionStage !== "confirm") {
      return actionError("当前不在需求确认阶段。", this.responseForContext(context));
    }

    if (!confirmed) {
      context.sessionStage = "fill_detail";
      return detailFormResponse(context);
    }

    context.sessionStage = "result";
    return resultResponse();
  }

  private handleButton(context: UIFlowContext, action: string): AIUIResponse {
    switch (action) {
      case "edit_requirement":
        if (context.sessionStage !== "confirm" && context.sessionStage !== "result") {
          return actionError("当前阶段不能编辑需求。", this.responseForContext(context));
        }
        context.sessionStage = "fill_detail";
        return detailFormResponse(context);

      case "back_to_type":
      case "choose_requirement_type":
        if (context.sessionStage !== "fill_detail" && context.sessionStage !== "confirm") {
          return actionError("当前阶段不能返回需求类型选择。", this.responseForContext(context));
        }
        context.sessionStage = "select_type";
        delete context.collectedData.requirementType;
        delete context.collectedData.title;
        delete context.collectedData.description;
        delete context.collectedData.priority;
        delete context.collectedData.acceptanceCriteria;
        return selectionResponse();

      case "cancel":
        if (context.sessionStage === "confirm") {
          context.sessionStage = "fill_detail";
          return detailFormResponse(context);
        }
        if (context.sessionStage === "fill_detail") {
          context.sessionStage = "select_type";
          return selectionResponse();
        }
        if (context.sessionStage === "result") {
          context.sessionStage = "confirm";
          return confirmationResponse(context);
        }
        return selectionResponse();

      case "confirm_analysis":
        if (context.sessionStage !== "confirm") {
          return actionError("请先完成需求填写并进入确认阶段。", this.responseForContext(context));
        }
        context.sessionStage = "result";
        return resultResponse();

      case "new_requirement":
        context.sessionStage = "select_type";
        context.collectedData = {};
        return selectionResponse();

      case "view_report":
        if (context.sessionStage !== "result") {
          return actionError("分析报告尚未生成。", this.responseForContext(context));
        }
        return resultResponse();

      default:
        return actionError("暂不支持这个 UI 操作。", this.responseForContext(context));
    }
  }

  private responseForContext(context: UIFlowContext): AIUIResponse {
    switch (context.sessionStage) {
      case "select_type":
        return selectionResponse();
      case "fill_detail":
        return detailFormResponse(context);
      case "confirm":
        return confirmationResponse(context);
      case "result":
        return resultResponse();
    }
  }
}
