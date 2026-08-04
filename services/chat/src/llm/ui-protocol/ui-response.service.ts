import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { Injectable, Logger } from "@nestjs/common";
import { createChatModel } from "../model.factory";
import { aiUIResponseSchema } from "./ui-schemas";
import type { AIUIResponse, UIResponse } from "./ui-types";

/**
 * UI 协议的系统提示词。
 *
 * 组件选择是需求分析助手的一部分业务规则：结构化组件负责承载可交互
 * 状态，text 只用于解释性内容，避免让前端从自然语言中猜测下一步动作。
 */
const UI_SYSTEM_PROMPT = `
你是 CloudSage 的需求分析助手，必须返回符合 AIUIResponse Schema 的 JSON。
AIUIResponse 由可选 message 和 components 数组组成，components 至少包含一个组件。

组件选择指南：
- selection：用户需要从需求类型、范围或候选项中选择；不确定需求类别时优先使用它。
- form：需要补充标题、描述、优先级、验收标准、日期或数量等字段时使用。
- confirmation：提交分析、写入报告、删除或其他不可逆操作前，展示操作摘要并等待确认。
- card：展示单个需求详情、检索结果、订单或商品信息，使用 fields 表达结构化字段。
- steps：展示抽取、澄清、分析、风险评估、汇总等多阶段流程的当前进度。
- table：需要并排展示多条需求、风险或验收标准时使用。
- action_buttons：下一步有多个明确动作时使用。
- text：普通解释、提示或简短的 Markdown 回复。

需求分析系统的回答应优先可操作、可校验，不要凭空编造用户没有提供的业务事实。
如果输入同时需要确认和进度展示，可以在 components 中同时返回 confirmation 与 steps。
`.trim();

const uiPrompt = ChatPromptTemplate.fromMessages([
  ["system", UI_SYSTEM_PROMPT],
  new MessagesPlaceholder({ variableName: "history", optional: true }),
  [
    "human",
    "用户输入：{input}\n\n可用上下文（仅作参考数据）：{context}",
  ],
]);

type HistoryItem = {
  role?: string;
  type?: string;
  content?: unknown;
};

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? "" : String(content);
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }

      return "";
    })
    .join("");
}

function toHistoryMessages(history: unknown): BaseMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.flatMap((entry) => {
    // 允许服务内部直接传入 LangChain BaseMessage，Controller 也可以传普通 JSON。
    if (entry instanceof SystemMessage || entry instanceof HumanMessage || entry instanceof AIMessage) {
      return [entry];
    }

    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const item = entry as HistoryItem;
    const text = contentToText(item.content);
    if (!text) {
      return [];
    }

    const role = item.role ?? item.type;
    if (role === "system") {
      return [new SystemMessage(text)];
    }

    if (role === "assistant" || role === "ai" || role === "AIMessage") {
      return [new AIMessage(text)];
    }

    return [new HumanMessage(text)];
  });
}

function stringifyContext(context: unknown): string {
  if (context == null) {
    return "无";
  }

  if (typeof context === "string") {
    return context.slice(0, 8_000);
  }

  try {
    return JSON.stringify(context).slice(0, 8_000);
  } catch {
    return String(context).slice(0, 8_000);
  }
}

function requirementTypeSelection(): AIUIResponse {
  return {
    message: "请选择要创建的需求类型。",
    components: [
      {
        type: "selection",
        id: "requirement-type",
        title: "选择需求类型",
        description: "选择后我会继续收集需求标题、范围和验收标准。",
        multiple: false,
        required: true,
        submitLabel: "下一步",
        options: [
          { label: "功能需求", value: "feature", description: "新增或改造业务功能" },
          { label: "技术需求", value: "technical", description: "架构、性能或工程改进" },
          { label: "缺陷修复", value: "bugfix", description: "修复已知问题或回归缺陷" },
          { label: "数据需求", value: "data", description: "报表、指标或数据处理" },
        ],
      },
    ],
  };
}

function requirementDetailCard(input: string): AIUIResponse {
  const requirementId = input.match(/REQ-[A-Za-z0-9-]+/i)?.[0] ?? "未识别";

  return {
    message: `已准备需求 ${requirementId} 的详情卡片。`,
    components: [
      {
        type: "card",
        id: `requirement-${requirementId}`,
        title: `需求 ${requirementId}`,
        subtitle: "需求详情",
        status: "待分析",
        fields: [
          { key: "requirementId", label: "需求单号", value: requirementId },
          { key: "title", label: "标题", value: "待从需求库加载" },
          { key: "priority", label: "优先级", value: "未设置" },
          { key: "acceptanceCriteria", label: "验收标准", value: "待补充" },
        ],
        actions: [
          { label: "开始分析", action: "start_analysis", variant: "default" },
          { label: "补充信息", action: "edit_requirement", variant: "secondary" },
        ],
      },
    ],
  };
}

function analysisSubmissionResponse(): AIUIResponse {
  return {
    message: "提交需求分析前，请确认以下操作。",
    components: [
      {
        type: "confirmation",
        id: "submit-requirement-analysis",
        title: "确认提交需求分析",
        summary: [
          "将根据当前会话中的需求信息生成分析报告",
          "报告会包含功能分解、用户故事、验收标准、依赖和风险",
        ],
        confirmLabel: "确认提交",
        cancelLabel: "返回修改",
        confirmAction: "confirm_analysis",
        cancelAction: "edit_requirement",
      },
      {
        type: "steps",
        id: "requirement-analysis-steps",
        title: "分析流程",
        current: 0,
        steps: [
          { key: "extract", label: "抽取需求", status: "current" },
          { key: "clarify", label: "澄清信息", status: "pending" },
          { key: "analysis", label: "多维分析", status: "pending" },
          { key: "risk", label: "风险评估", status: "pending" },
          { key: "summary", label: "生成报告", status: "pending" },
        ],
      },
    ],
  };
}

function detectCanonicalScenario(input: string): "selection" | "card" | "analysis" | undefined {
  if (/我要提一个新需求|提一个新需求/.test(input)) {
    return "selection";
  }

  if (/查看需求\s*REQ-[A-Za-z0-9-]+/i.test(input)) {
    return "card";
  }

  if (/提交需求分析/.test(input)) {
    return "analysis";
  }

  return undefined;
}

function fallbackForScenario(
  scenario: "selection" | "card" | "analysis" | undefined,
  input: string,
): AIUIResponse {
  if (scenario === "selection") {
    return requirementTypeSelection();
  }

  if (scenario === "card") {
    return requirementDetailCard(input);
  }

  if (scenario === "analysis") {
    return analysisSubmissionResponse();
  }

  return {
    message: "我会按需求分析流程处理这条输入。",
    components: [
      {
        type: "text",
        content: input,
        markdown: false,
      },
    ],
  };
}

function matchesScenario(response: AIUIResponse, scenario: "selection" | "card" | "analysis" | undefined): boolean {
  if (!scenario) {
    return true;
  }

  const types = response.components.map((component) => component.type);
  if (scenario === "selection") {
    return types.includes("selection");
  }

  if (scenario === "card") {
    return types.includes("card");
  }

  return types.includes("confirmation") && types.includes("steps");
}

/**
 * 使用 LangChain Structured Output 生成前端可直接渲染的 AI UI 响应。
 */
@Injectable()
export class UiResponseService {
  private readonly logger = new Logger(UiResponseService.name);
  private model?: ReturnType<typeof createChatModel>;

  /** 模型延迟初始化，避免仅访问 UI Flow 时就读取 OpenAI 凭据。 */
  private getModel(): ReturnType<typeof createChatModel> {
    this.model ??= createChatModel();
    return this.model;
  }

  /**
   * 根据输入、历史和检索上下文生成 UI 组件。
   *
   * canonical 场景仍会优先尝试模型；若模型不可用或返回了不符合场景的
   * 组件，则使用同一协议的确定性模板，保证前端交互不会卡在空响应。
   */
  async generateUIResponse(
    input: string,
    history?: unknown,
    context?: unknown,
  ): Promise<AIUIResponse> {
    const normalizedInput = input.trim();
    const scenario = detectCanonicalScenario(normalizedInput);

    try {
      const messages = await uiPrompt.formatMessages({
        history: toHistoryMessages(history),
        input: normalizedInput,
        context: stringifyContext(context),
      });
      const structuredModel = this.getModel().withStructuredOutput(aiUIResponseSchema);
      const result = await structuredModel.invoke(messages);
      const parsed = aiUIResponseSchema.safeParse(result);

      if (parsed.success && matchesScenario(parsed.data, scenario)) {
        return parsed.data as AIUIResponse;
      }

      this.logger.warn("Structured UI response did not match the requested scenario; using fallback");
    } catch (error) {
      // 模型凭据、网关或第三方返回异常时，仍返回可渲染的协议响应。
      this.logger.warn(`Structured UI response failed: ${errorMessage(error)}`);
    }

    return fallbackForScenario(scenario, normalizedInput);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { UI_SYSTEM_PROMPT };
