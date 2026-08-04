/**
 * UI 协议中的通用选项。
 *
 * 前端可以直接使用 value 作为回传给 /api/ui-chat/action 的稳定标识，
 * 不需要依赖展示文案做分支判断。
 */
export interface UIOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

/** 纯文本或 Markdown 回复。 */
export interface TextUIResponse {
  type: "text";
  content: string;
  markdown?: boolean;
}

/** 单选/多选卡片。 */
export interface SelectionUIResponse {
  type: "selection";
  id?: string;
  title: string;
  description?: string;
  options: UIOption[];
  multiple?: boolean;
  required?: boolean;
  submitLabel?: string;
}

export type FormFieldType = "input" | "select" | "textarea" | "date" | "number";

/** 动态表单字段定义。 */
export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  options?: UIOption[];
}

/** 动态表单组件。 */
export interface FormUIResponse {
  type: "form";
  id?: string;
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  cancelLabel?: string;
}

/** 确认对话框，适合提交分析、写入报告等需要用户确认的操作。 */
export interface ConfirmationUIResponse {
  type: "confirmation";
  id?: string;
  title: string;
  summary: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  confirmAction?: string;
  cancelAction?: string;
}

export interface CardField {
  label: string;
  value: string | number | boolean | null;
  key?: string;
}

export interface CardAction {
  label: string;
  action: string;
  variant?: "default" | "secondary" | "danger";
  disabled?: boolean;
}

/** 需求详情、检索结果或商品信息展示卡片。 */
export interface CardUIResponse {
  type: "card";
  id?: string;
  title: string;
  subtitle?: string;
  status?: string;
  fields: CardField[];
  actions?: CardAction[];
}

export type StepStatus = "pending" | "current" | "completed" | "error";

export interface UIStep {
  key: string;
  label: string;
  description?: string;
  status: StepStatus;
}

/** 多阶段需求分析进度。 */
export interface StepsUIResponse {
  type: "steps";
  id?: string;
  title?: string;
  current: number;
  steps: UIStep[];
}

export interface TableColumn {
  key: string;
  label: string;
}

export type TableCell = string | number | boolean | null;

/** 批量展示结构化数据。 */
export interface TableUIResponse {
  type: "table";
  id?: string;
  title?: string;
  columns: TableColumn[];
  rows: Array<Record<string, TableCell>>;
}

export interface ActionButton {
  label: string;
  action: string;
  variant?: "default" | "secondary" | "danger";
  disabled?: boolean;
}

/** 一组可点击的后续动作。 */
export interface ActionButtonsUIResponse {
  type: "action_buttons";
  id?: string;
  title?: string;
  buttons: ActionButton[];
}

/** AI 可以返回的任意一个 UI 组件。 */
export type UIResponse =
  | TextUIResponse
  | SelectionUIResponse
  | FormUIResponse
  | ConfirmationUIResponse
  | CardUIResponse
  | StepsUIResponse
  | TableUIResponse
  | ActionButtonsUIResponse;

/** 结构化 AI 回复信封，message 用于非组件式补充说明。 */
export interface AIUIResponse {
  message?: string;
  components: UIResponse[];
}

/** 前端提交给后端的 UI 操作。 */
export type UIAction =
  | {
      type: "selection";
      componentId?: string;
      value: string | string[];
    }
  | {
      type: "form_submit";
      componentId?: string;
      values: Record<string, string | number | boolean | null>;
    }
  | {
      type: "confirmation";
      componentId?: string;
      confirmed: boolean;
      action?: string;
    }
  | {
      type: "button";
      componentId?: string;
      action: string;
      payload?: Record<string, unknown>;
    };
