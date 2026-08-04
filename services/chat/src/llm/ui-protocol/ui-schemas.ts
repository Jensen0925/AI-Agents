import { z } from "zod";

export const uiOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
});

export const textResponseSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
  markdown: z.boolean().optional(),
});

export const selectionResponseSchema = z.object({
  type: z.literal("selection"),
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  options: z.array(uiOptionSchema).min(1),
  multiple: z.boolean().optional(),
  required: z.boolean().optional(),
  submitLabel: z.string().optional(),
});

export const formFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["input", "select", "textarea", "date", "number"]),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number()]).optional(),
  options: z.array(uiOptionSchema).optional(),
});

export const formResponseSchema = z.object({
  type: z.literal("form"),
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(formFieldSchema).min(1),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

export const confirmationResponseSchema = z.object({
  type: z.literal("confirmation"),
  id: z.string().optional(),
  title: z.string().min(1),
  summary: z.union([z.string(), z.array(z.string()).min(1)]),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  confirmAction: z.string().optional(),
  cancelAction: z.string().optional(),
});

export const cardFieldSchema = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  key: z.string().optional(),
});

export const cardActionSchema = z.object({
  label: z.string().min(1),
  action: z.string().min(1),
  variant: z.enum(["default", "secondary", "danger"]).optional(),
  disabled: z.boolean().optional(),
});

export const cardResponseSchema = z.object({
  type: z.literal("card"),
  id: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  status: z.string().optional(),
  fields: z.array(cardFieldSchema),
  actions: z.array(cardActionSchema).optional(),
});

export const stepSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["pending", "current", "completed", "error"]),
});

export const stepsResponseSchema = z.object({
  type: z.literal("steps"),
  id: z.string().optional(),
  title: z.string().optional(),
  current: z.number().int().nonnegative(),
  steps: z.array(stepSchema).min(1),
});

export const tableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
});

export const tableCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const tableResponseSchema = z.object({
  type: z.literal("table"),
  id: z.string().optional(),
  title: z.string().optional(),
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), tableCellSchema)),
});

export const actionButtonSchema = z.object({
  label: z.string().min(1),
  action: z.string().min(1),
  variant: z.enum(["default", "secondary", "danger"]).optional(),
  disabled: z.boolean().optional(),
});

export const actionButtonsResponseSchema = z.object({
  type: z.literal("action_buttons"),
  id: z.string().optional(),
  title: z.string().optional(),
  buttons: z.array(actionButtonSchema).min(1),
});

/** 基于 type 精确匹配每一个 UI 组件。 */
export const uiResponseSchema = z.discriminatedUnion("type", [
  textResponseSchema,
  selectionResponseSchema,
  formResponseSchema,
  confirmationResponseSchema,
  cardResponseSchema,
  stepsResponseSchema,
  tableResponseSchema,
  actionButtonsResponseSchema,
]);

/** LangChain Structured Output 使用的完整 AI 回复 Schema。 */
export const aiUIResponseSchema = z.object({
  message: z.string().optional(),
  components: z.array(uiResponseSchema).min(1),
});

const actionValueSchema = z.union([z.string(), z.array(z.string()).min(1)]);
const actionFormValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** UIAction 的运行时校验 Schema，Controller 与 Flow Service 共用。 */
export const uiActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selection"),
    componentId: z.string().optional(),
    value: actionValueSchema,
  }),
  z.object({
    type: z.literal("form_submit"),
    componentId: z.string().optional(),
    values: actionFormValuesSchema,
  }),
  z.object({
    type: z.literal("confirmation"),
    componentId: z.string().optional(),
    confirmed: z.boolean(),
    action: z.string().optional(),
  }),
  z.object({
    type: z.literal("button"),
    componentId: z.string().optional(),
    action: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type UIResponseSchema = z.infer<typeof uiResponseSchema>;
export type AIUIResponseSchema = z.infer<typeof aiUIResponseSchema>;
export type UIActionSchema = z.infer<typeof uiActionSchema>;
