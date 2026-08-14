import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { Injectable, Logger } from "@nestjs/common";
import {
  type DocumentSearchResult,
  SearchService,
} from "../document/search.service";
import { loadLangchainConfig } from "../config/load-langchain-config";
import { DbChatHistory } from "../message/db-chat-history";
import { MessageService } from "../message/message.service";
import {
  type OrchestrationResult,
  type RequirementAgentName,
  OrchestratorService,
} from "./agents/orchestrator.service";
import {
  type AnalysisGraphStep,
  classifyIntentByKeywords,
  type RequirementIntent,
  type RunAnalysisGraphOutput,
} from "./graph/requirement-analysis-graph";
import { runAnalysisGraph } from "./graph/analysis-graph.runner";

export interface AdvancedAnalysisResult {
  report: string | null;
  /** 当前处理状态；失败时前端仍可展示 summary 中的安全降级说明。 */
  status?: "completed" | "clarification_required" | "failed";
  /** 模型链路失败后的降级方式。 */
  fallback?: "manual_review" | null;
  /** 本轮意图，供前端决定展示聊天、查询或需求分析结果。 */
  intent?: RequirementIntent;
  /** LangGraph 的兼容摘要字段；普通闲聊/查询也会填充。 */
  summary?: string;
  clarificationQuestions?: string[];
  usedAgents: RequirementAgentName[];
  retrievedDocuments: DocumentSearchResult[];
  queryResponse?: string;
  chatResponse?: string;
  steps?: AnalysisGraphStep[];
}

function contentToText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) =>
      "text" in block && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

function formatRetrievedContext(documents: DocumentSearchResult[]): string {
  if (documents.length === 0) {
    return "当前用户知识库没有检索到相关文档。";
  }

  return documents
    .map(
      (document, index) => {
        const score = Number.isFinite(document.score) ? document.score : 0;
        return `[检索文档 ${index + 1}，相关度 ${score.toFixed(4)}]\n${document.content}`;
      },
    )
    .join("\n\n");
}

const ANALYSIS_STEPS = new Set<AnalysisGraphStep>([
  "classifier",
  "triage",
  "extractStep",
  "clarifyStep",
  "analysisStep",
  "analysisAgent",
  "analysisTools",
  "analysisFinalize",
  "riskStep",
  "summaryStep",
  "riskOnlyHandler",
  "queryHandler",
  "chatHandler",
]);

function isAnalysisStep(value: unknown): value is AnalysisGraphStep {
  return typeof value === "string" && ANALYSIS_STEPS.has(value as AnalysisGraphStep);
}

function normalizeDocuments(value: unknown): DocumentSearchResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as { content?: unknown; score?: unknown };
    if (typeof record.content !== "string") {
      return [];
    }
    const score = Number(record.score);
    return [{ content: record.content, score: Number.isFinite(score) ? score : 0 }];
  });
}

/**
 * LangGraph/旧编排都属于外部模型边界，不能假定第三方实现一定返回完整对象。
 * 统一在服务层把异常或不完整结果收敛为可序列化的最小结果，避免 Nest 将
 * TypeError 变成 HTTP 500。
 */
function normalizeGraphResult(
  value: unknown,
  input: string,
  retrievedDocuments: DocumentSearchResult[],
): RunAnalysisGraphOutput {
  if (!value || typeof value !== "object") {
    return localFallbackResult(input, retrievedDocuments);
  }

  const candidate = value as Partial<RunAnalysisGraphOutput>;
  const intent: RequirementIntent =
    candidate.intent === "query" ||
    candidate.intent === "chat" ||
    candidate.intent === "risk_only" ||
    candidate.intent === "analyze"
      ? candidate.intent
      : classifyIntentByKeywords(input);
  const steps = Array.isArray(candidate.steps)
    ? candidate.steps.filter(isAnalysisStep)
    : [];
  const fallback = localFallbackResult(input, retrievedDocuments);

  // `fallback` 是按关键词生成的安全基线，而不是本次图运行的真实结果。
  // 例如“判断需求是否完整并产出报告”同时包含“报告”关键词，基线会被
  // 识别为 query；如果图已经明确返回 intent=analyze，不能继续沿用基线
  // 的 queryResponse，否则最终会把分析请求错误地持久化成查询回复。
  const queryResponse =
    intent === "query" && typeof candidate.queryResponse === "string"
      ? candidate.queryResponse
      : intent === "query" && typeof fallback.queryResponse === "string"
        ? fallback.queryResponse
        : undefined;
  const chatResponse =
    intent === "chat" && typeof candidate.chatResponse === "string"
      ? candidate.chatResponse
      : intent === "chat" && typeof fallback.chatResponse === "string"
        ? fallback.chatResponse
        : undefined;

  return {
    ...fallback,
    ...candidate,
    messages: Array.isArray(candidate.messages) ? candidate.messages : [],
    intent,
    queryResponse,
    chatResponse,
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary
        : fallback.summary,
    steps: steps.length > 0 ? steps : fallback.steps,
  };
}

function parseClarificationQuestions(clarified?: string): string[] {
  if (!clarified) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(clarified);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "questions" in parsed &&
      Array.isArray(parsed.questions)
    ) {
      return parsed.questions.filter(
        (question): question is string =>
          typeof question === "string" && question.trim().length > 0,
      );
    }
  } catch {
    // Agent 输出可能带有 Markdown 代码块或非 JSON 文本；此时不阻断主流程。
  }

  return [];
}

function analysisConclusion(result: RunAnalysisGraphOutput): string {
  if (result.intent === "chat" && result.chatResponse?.trim()) {
    return result.chatResponse.trim();
  }

  if (result.intent === "query" && result.queryResponse?.trim()) {
    return result.queryResponse.trim();
  }

  const clarificationQuestions = parseClarificationQuestions(result.clarified);
  // 会话式澄清会把“已记录的信息 + 下一问题”放入 summary，必须原样展示；
  // 旧编排则只提供 clarified，不能让归一化时附带的本地报告覆盖它。
  if (
    result.summary?.trim() &&
    /^(正在完善|我先记下)/u.test(result.summary.trim())
  ) {
    return result.summary.trim();
  }
  if (clarificationQuestions.length > 0) {
    return [
      "需要进一步澄清以下问题：",
      ...clarificationQuestions.map((question) =>
        `- ${question}`,
      ),
    ].join("\n");
  }

  if (result.summary?.trim()) {
    return result.summary.trim();
  }

  return "需求分析未能完成，任务已转入人工审核。";
}

/**
 * 聊天接口是同步 HTTP 请求，而完整 Supervisor + Expert + Critic 图可能
 * 需要多次访问外部模型。模型网关发生慢响应时，不能让 HTTP 请求一直悬挂。
 * 这个错误只用于区分“达到总时限”和“立即发生的真实异常”：前者走本地
 * 可展示降级，后者仍保留旧 Orchestrator 兼容路径。
 */
class AnalysisDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Analysis graph exceeded ${timeoutMs}ms deadline`);
    this.name = "AnalysisDeadlineError";
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AnalysisDeadlineError(timeoutMs)),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 只有用户明确要求拆解/报告时，才启动完整的多 Agent 分析链。 */
function requestsFullAnalysis(input: string): boolean {
  return /(?:分析|拆解|评估|生成|输出|整理).*(?:需求|报告|方案|功能分解|用户故事|验收标准|开发排期)|(?:需求分析|完整分析|综合分析|功能分解|用户故事|验收标准|开发排期)/iu.test(
    input,
  );
}

/** 短业务描述先澄清关键信息，避免用固定报告“猜测”用户意图。 */
function isBriefRequirement(input: string): boolean {
  return (
    input.length <= 100 &&
    /(登录|注册|权限|鉴权|认证|验证码|账号.{0,3}密码|导入|导出|支付|订单|搜索|报表|系统|功能|接口|页面|需求|模块)/iu.test(
      input,
    )
  );
}

function isLoginClarificationAnswer(input: string): boolean {
  return /^(?:账号.{0,3}密码|密码登录|手机号.{0,4}验证码|验证码登录|第三方登录|微信登录|钉钉登录|SSO|管理员.{0,12}|普通用户.{0,12}|访客.{0,12}|需要.{0,20}(?:验证码|锁定|找回密码|双因素|记住登录)|(?:首页|工作台|dashboard|会话有效期).{0,20})$/iu.test(
    input.trim(),
  );
}

function userMessagesText(history: BaseMessage[], input: string): string[] {
  return [
    ...history
      .filter((message) => message.getType() === "human")
      .map((message) => contentToText(message.content).trim())
      .filter(Boolean),
    input,
  ];
}

function latestMatchingText(
  messages: string[],
  pattern: RegExp,
): string | undefined {
  return [...messages].reverse().find((message) => pattern.test(message));
}

function createLoginClarification(
  input: string,
  history: BaseMessage[],
): { response: string; questions: string[] } {
  const messages = userMessagesText(history, input);
  const requirement = messages.find(
    (message) =>
      /(想做|需要|开发|实现|创建|设计).*(登录|注册|鉴权|认证)|(登录|注册).*(页面|功能|系统)/iu.test(
        message,
      ),
  );
  const loginMethod = latestMatchingText(
    messages,
    /(账号.{0,3}密码|密码登录|手机号.{0,4}验证码|验证码登录|第三方登录|微信登录|钉钉登录|SSO)/iu,
  );
  const roles = latestMatchingText(
    messages,
    /(管理员|普通用户|访客|运营|员工|商家|客户|角色)/iu,
  );
  const security = latestMatchingText(
    messages,
    /(失败锁定|找回密码|双因素|二次认证|记住登录|图形验证码|验证码保护)/iu,
  );
  const destination = latestMatchingText(
    messages,
    /(跳转|首页|工作台|dashboard|会话有效期|登录状态|天有效)/iu,
  );

  const answered = [
    loginMethod ? `登录方式：${loginMethod}` : "",
    roles ? `用户角色：${roles}` : "",
    security ? `安全规则：${security}` : "",
    destination ? `登录后行为：${destination}` : "",
  ].filter(Boolean);

  let nextQuestion: string;
  if (!loginMethod) {
    nextQuestion =
      "登录方式选哪一种：账号密码、手机号验证码、第三方登录，还是 SSO？";
  } else if (!roles) {
    nextQuestion = "用户角色有哪些？例如管理员、普通用户；不同角色登录后能访问哪些功能？";
  } else if (!security) {
    nextQuestion = "安全规则需要哪些：验证码保护、连续失败锁定、找回密码、记住登录或双因素认证？";
  } else if (!destination) {
    nextQuestion = "登录成功后要跳转到哪里？登录状态或会话有效期需要保持多久？";
  } else {
    nextQuestion =
      "关键信息已齐全。你希望我下一步输出登录页面原型、接口设计，还是完整的功能拆解与验收标准？";
  }

  const response = [
    requirement ? `正在完善：${requirement}` : "正在完善登录需求。",
    answered.length ? `已记录：${answered.join("；")}。` : "",
    "",
    `下一步请确认：${nextQuestion}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { response, questions: [nextQuestion] };
}

function createBriefClarificationResult(
  input: string,
  history: BaseMessage[] = [],
): RunAnalysisGraphOutput {
  let questions: string[] = [];
  let response = "";
  if (/(登录|注册|鉴权|认证)/iu.test(input) ||
      history.some((message) =>
        message.getType() === "human" &&
        /(登录|注册|鉴权|认证)/iu.test(contentToText(message.content)),
      )) {
    ({ response, questions } = createLoginClarification(input, history));
  } else if (/(导入|导出|Excel|CSV)/iu.test(input)) {
    questions = [
      "需要导入或导出的文件格式、最大行数和单文件大小是多少？",
      "字段映射、必填校验和重复数据如何处理？",
      "失败记录是否需要提供下载或重新处理？",
      "哪些角色可以执行这项操作？",
    ];
  } else if (/(权限|角色|鉴权)/iu.test(input)) {
    questions = [
      "系统需要哪些角色和权限粒度（菜单、按钮、数据范围）？",
      "权限变更是否需要审批和审计记录？",
      "无权限访问时应如何提示和处理？",
    ];
  } else {
    questions = [
      "目标用户是谁，主要要解决什么问题？",
      "核心流程和必须支持的功能有哪些？",
      "验收标准、优先级和边界条件分别是什么？",
    ];
  }
  if (!response) {
    response = [
      `我先记下这个需求：${input}`,
      "",
      "为了把需求设计准确，请补充以下信息：",
      ...questions.map((question) => `- ${question}`),
      "",
      "补充后我可以继续输出功能拆解、接口建议和验收标准。",
    ].join("\n");
  }
  return {
    messages: [new AIMessage(response)],
    intent: "analyze",
    clarified: JSON.stringify({ needsClarification: true, questions }),
    summary: response,
    steps: ["classifier", "clarifyStep"],
  };
}

function createLocalChatResponse(input: string): string {
  if (/(什么模型|哪个模型|模型版本)/iu.test(input)) {
    return "我是 CloudSage 应用里的需求分析助手。底层模型由服务端当前的模型配置决定；我不能仅凭聊天内容可靠确认具体模型名称。";
  }
  if (/(天气|气温|下雨|晴)/iu.test(input)) {
    return "我无法直接获取实时天气，但可以帮你查询天气接口需求、设计展示方案，或分析一段天气相关的产品需求。";
  }
  if (/(你能做什么|有什么能力|帮助)/iu.test(input)) {
    return "我是 CloudSage 需求分析助手，可以进行需求澄清、功能拆解、风险评估、知识库查询和验收标准整理。";
  }
  if (/(谢谢|感谢)/iu.test(input)) {
    return "不客气。如果你愿意，继续发我一段需求，我可以帮你把它整理成可执行的方案。";
  }
  return "你好！我是 CloudSage 需求分析助手。你可以直接描述想做的功能，或让我帮你分析、查询和拆解需求。";
}

function hasOrderQueryContext(input: string, history: BaseMessage[]): boolean {
  return (
    /(订单|物流|发货|退款单|支付单)/iu.test(input) ||
    history.some(
      (message) =>
        message.getType() === "human" &&
        /(订单|物流|发货|退款单|支付单)/iu.test(
          contentToText(message.content),
        ),
    )
  );
}

function createOrderQueryResult(
  input: string,
  history: BaseMessage[],
): RunAnalysisGraphOutput {
  const hasOrderId = /(?:订单(?:号|编号)?|order\s*id)\s*[:：#]?[A-Za-z0-9_-]{4,}/iu.test(
    input,
  );
  const asksWhy = /(为什么|为何|怎么不能|不能查询|查不了|无法查询)/iu.test(
    input,
  );
  let response: string;
  if (asksWhy) {
    response = [
      "因为当前 CloudSage Chat 服务还没有接入订单数据库或订单查询 API。",
      "现在已接入的是会话、需求分析和用户文档知识库；没有真实订单数据时，我不能编造订单状态。",
      "要支持实际查询，需要接入订单服务，并按当前登录用户校验订单访问权限。",
    ].join("\n");
  } else if (hasOrderId) {
    response = [
      "我识别到了订单编号，但当前服务尚未接入订单数据源，所以暂时不能返回真实状态。",
      "接入订单 API 后，可以继续查询订单状态、支付状态、物流信息和退款进度。",
    ].join("\n");
  } else {
    response = [
      "可以帮你梳理订单查询，但当前服务还没有接入真实订单数据源。",
      "请先提供订单号，并说明要查询的是订单状态、支付状态、物流还是退款进度。",
      "若要返回真实结果，还需要把订单 API 或数据库查询工具接入 CloudSage。",
    ].join("\n");
  }
  return {
    messages: [new AIMessage(response)],
    intent: "query",
    queryResponse: response,
    summary: response,
    steps: ["classifier", "queryHandler"],
  };
}

function localFallbackResult(
  input: string,
  retrievedDocuments: DocumentSearchResult[],
): RunAnalysisGraphOutput {
  const intent = classifyIntentByKeywords(input);

  if (intent === "chat") {
    const response = createLocalChatResponse(input);
    return {
      messages: [new AIMessage(response)],
      intent,
      chatResponse: response,
      summary: response,
      steps: ["classifier", "chatHandler"],
    };
  }

  if (intent === "query") {
    const response = retrievedDocuments.length
      ? [
          "已找到与该需求相关的知识库内容：",
          ...retrievedDocuments.map(
            (document, index) => `${index + 1}. ${document.content}`,
          ),
        ].join("\n")
      : "暂未找到该需求的可用记录，请确认需求编号或稍后重试。";
    return {
      messages: [new AIMessage(response)],
      intent,
      queryResponse: response,
      summary: response,
      steps: ["classifier", "queryHandler"],
    };
  }

  if (!requestsFullAnalysis(input)) {
    return createBriefClarificationResult(input);
  }

  const securityNote = /(登录|认证|鉴权|密码|权限|安全)/i.test(input)
    ? "\n- 安全重点：确认身份源、密码策略、会话生命周期、权限边界和审计留痕。"
    : "";
  const report = [
    "## 需求摘要",
    "",
    `本需求目标是：${input.replace(/^分析需求[:：]?\s*/u, "")}`,
    "当前已完成初步范围识别，详细业务规则、异常流程和外部依赖仍需在评审阶段确认。",
    "",
    "## 功能分解",
    "",
    "- 需求输入与参数校验",
    "- 核心业务流程与状态流转",
    "- 结果反馈、异常处理与审计记录",
    "",
    "## 用户故事",
    "",
    "- 作为业务用户，我希望按明确流程完成目标操作，以便获得可预期的结果。",
    "",
    "## 验收标准",
    "",
    "- Given 输入满足校验规则，When 执行核心流程，Then 返回成功结果并记录必要日志。",
    "- Given 输入不完整或非法，When 提交请求，Then 返回可理解的错误提示且不产生脏数据。",
    securityNote,
    "",
    "## 技术复杂度",
    "",
    "中等：需要明确领域模型、权限边界、异常流程以及与现有 API/数据库的依赖。",
    "",
    "## 开发排期",
    "",
    "1. 需求澄清（0.5 天）→ 依赖业务规则确认。",
    "2. API 与数据模型（1-2 天）→ 依赖需求字段和权限方案。",
    "3. 前端交互与联调（1-2 天）→ 依赖 API 契约稳定。",
    "4. 测试与上线（1 天）→ 依赖前述开发和验收标准完成。",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    messages: [new AIMessage(report)],
    intent,
    analysisResult: report,
    analysis: report,
    risk: securityNote.trim(),
    riskResult: securityNote.trim(),
    summary: report,
    steps: [
      "classifier",
      "extractStep",
      "clarifyStep",
      "analysisStep",
      "riskStep",
      "summaryStep",
    ],
  };
}

/**
 * 模型网关的“模型不存在/认证失败”属于不可恢复的配置问题。
 * 这类错误不应该再尝试旧版编排：旧编排会重复访问同一个网关，
 * 只会增加等待时间，最后仍返回相同错误。
 */
function isModelUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /MODEL_NOT_FOUND|MODEL_AUTHENTICATION|not supported by any configured account|invalid token|authenticationerror|\b401\b|\b404\b/i.test(
    message,
  );
}

function legacyResultToGraphResult(
  result: OrchestrationResult,
): RunAnalysisGraphOutput {
  const clarification = JSON.stringify({
    needsClarification: result.clarificationQuestions.length > 0,
    questions: result.clarificationQuestions,
  });
  const steps: AnalysisGraphStep[] = result.usedAgents.flatMap((agent) => {
    const stepMap: Record<RequirementAgentName, AnalysisGraphStep> = {
      extractAgent: "extractStep",
      clarifyAgent: "clarifyStep",
      analysisAgent: "analysisStep",
      riskAgent: "riskStep",
      summaryAgent: "summaryStep",
    };
    return [stepMap[agent]];
  });

  return {
    messages: [],
    intent: "analyze",
    clarified: clarification,
    summary:
      result.report ??
      (result.clarificationQuestions.length > 0
        ? ""
        : "需求分析未能完成，任务已转入人工审核。"),
    steps,
  };
}

/**
 * 统一串联 PostgreSQL 会话记忆、用户文档检索和 Multi-Agent 需求分析。
 */
@Injectable()
export class AdvancedAnalysisService {
  private readonly logger = new Logger(AdvancedAnalysisService.name);
  /**
   * 默认给完整图 30 秒。多 Agent 图通常包含数次模型调用，8 秒会在模型
   * 已经正常返回时被服务端提前截断。可通过 CHAT_ANALYSIS_TIMEOUT_MS 调整；
   * 0 或负数表示不启用总时限。
   */
  private readonly analysisTimeoutMs = Number(
    process.env["CHAT_ANALYSIS_TIMEOUT_MS"] ?? 30_000,
  );
  /** 向量模型首次加载可能访问外部模型仓库，因此检索单独设置较短预算。 */
  private readonly retrievalTimeoutMs = Number(
    process.env["CHAT_RETRIEVAL_TIMEOUT_MS"] ?? 2_500,
  );

  constructor(
    // 保留旧编排服务作为图异常时的兼容降级路径；正常请求始终走 LangGraph。
    private readonly orchestratorService: OrchestratorService,
    private readonly messageService: MessageService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * 使用已有历史与当前用户知识库增强本轮输入，执行分析后将问答写回消息表。
   */
  async analyze(
    userId: string,
    conversationId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    try {
      return await this.analyzeInternal(userId, conversationId, input);
    } catch (error) {
      // 这是最后一道边界保护：即使出现未预期的同步异常、第三方返回格式
      // 变化或 Nest 序列化前的 TypeError，聊天接口也必须返回稳定 JSON，不能
      // 把用户留在“Request failed with status code 500”。
      this.logger.error(
        `Unexpected analysis failure: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }`,
      );
      // 即使出现未预期的同步异常，也返回确定性的本地结果。
      // `status=failed` 仍保留给调用方做监控，但 `report/summary` 必须可展示，
      // 不能把“人工审核”占位文本作为用户唯一答案。
      const fallback = localFallbackResult(input, []);
      const conclusion = analysisConclusion(fallback);
      return {
        report: fallback.intent === "analyze" ? conclusion : null,
        status: "failed",
        fallback: "manual_review",
        intent: fallback.intent,
        summary: conclusion,
        clarificationQuestions: [],
        usedAgents: [],
        retrievedDocuments: [],
        queryResponse: fallback.queryResponse,
        chatResponse: fallback.chatResponse,
        steps: fallback.steps,
      };
    }
  }

  private async analyzeInternal(
    userId: string,
    conversationId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      return {
        report: "请输入需要分析的内容。",
        status: "failed",
        fallback: null,
        intent: "analyze",
        summary: "请输入需要分析的内容。",
        clarificationQuestions: [],
        usedAgents: [],
        retrievedDocuments: [],
        steps: ["classifier"],
      };
    }

    const chatHistory = new DbChatHistory(
      conversationId,
      this.messageService,
    );
    let history: Awaited<ReturnType<DbChatHistory["getMessages"]>> = [];
    try {
      history = await withDeadline(
        chatHistory.getMessages(),
        Math.min(3_000, this.retrievalTimeoutMs),
      );
    } catch (error) {
      // 历史消息读取失败时仍允许当前消息进入分析，避免 UI 因旧数据损坏而
      // 完全不可用；当前请求仍会先保留用户消息，再继续执行本轮分析。
      this.logger.warn(
        `Conversation history unavailable; continuing without history: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 先落库用户消息，再执行耗时的检索和模型编排。
    // 这样前端切换会话、重新拉取历史时，即使本轮模型还没有返回，
    // 也能立即看到用户刚发送的内容；assistant 结果仍在流程结束后写入。
    try {
      await withDeadline(
        chatHistory.addMessage(new HumanMessage(normalizedInput)),
        Math.min(3_000, this.retrievalTimeoutMs),
      );
    } catch (error) {
      // 用户消息落库失败时继续完成本轮回答；这样数据库短暂抖动不会把聊天
      // 页面变成 500。错误仍然记录，便于后续修复数据库或迁移状态。
      this.logger.error(
        `User message persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 轻量请求不应进入检索和多 Agent 图：闲聊直接回复，短需求先澄清。
    // 这也避免模型网关超时后把所有输入都误包装成同一份固定报告。
    const keywordIntent = classifyIntentByKeywords(normalizedInput);
    const hasLoginConversation = history.some(
      (message) =>
        message.getType() === "human" &&
        /(登录|注册|鉴权|认证)/iu.test(contentToText(message.content)),
    );
    const shouldHandleOrderQuery =
      keywordIntent === "query" &&
      hasOrderQueryContext(normalizedInput, history);
    const shouldUseQuickPath =
      keywordIntent === "chat" ||
      shouldHandleOrderQuery ||
      (keywordIntent === "analyze" &&
        (isBriefRequirement(normalizedInput) ||
          (hasLoginConversation &&
            isLoginClarificationAnswer(normalizedInput))) &&
        !requestsFullAnalysis(normalizedInput));
    if (shouldUseQuickPath) {
      const quickResult =
        keywordIntent === "chat"
          ? localFallbackResult(normalizedInput, [])
          : shouldHandleOrderQuery
            ? createOrderQueryResult(normalizedInput, history)
          : createBriefClarificationResult(normalizedInput, history);
      const conclusion = analysisConclusion(quickResult);
      try {
        await withDeadline(
          chatHistory.addMessage(new AIMessage(conclusion)),
          Math.min(2_000, this.retrievalTimeoutMs),
        );
      } catch (error) {
        this.logger.error(
          `Assistant quick-path persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const clarificationQuestions = parseClarificationQuestions(
        quickResult.clarified,
      );
      return {
        report: null,
        status:
          keywordIntent === "analyze"
            ? "clarification_required"
            : "completed",
        fallback: null,
        intent: keywordIntent,
        summary: conclusion,
        clarificationQuestions,
        usedAgents: [],
        retrievedDocuments: [],
        queryResponse: quickResult.queryResponse,
        chatResponse: quickResult.chatResponse,
        steps: quickResult.steps,
      };
    }

    let retrievedDocuments: DocumentSearchResult[] = [];
    let retrieval = {
      enabled: false,
      topK: 3,
    };
    try {
      const config = loadLangchainConfig();
      retrieval = {
        enabled: config.retrieval.enabled,
        topK: config.retrieval.topK,
      };
    } catch (error) {
      this.logger.warn(
        `LangChain retrieval config unavailable; continuing without retrieval: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (retrieval.enabled) {
      try {
        retrievedDocuments = await withDeadline(
          this.searchService.similaritySearch(
            normalizedInput,
            userId,
            Math.max(1, Math.floor(retrieval.topK)),
          ),
          this.retrievalTimeoutMs,
        );
      } catch (error) {
        // 语义检索属于可选增强能力；模型或向量库不可用时使用空上下文，
        // 仍然返回人工审核或模型可生成的分析结果，而不是 HTTP 500。
        this.logger.warn(
          `Document retrieval unavailable; continuing without context: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const historyContext = history
      .map((message) => {
        const role = message.getType() === "human" ? "用户" : "助手";
        return `${role}：${contentToText(message.content)}`;
      })
      .join("\n");
    // 意图分类必须只看当前输入；历史与检索资料作为 Agent 的增强上下文传入。
    // 若把历史直接拼进分类文本，历史中的“需求/报告”等词会把普通闲聊误判为 analyze。
    const context = [
      historyContext ? `会话历史：\n${historyContext}` : "",
      `知识库检索上下文：\n${formatRetrievedContext(retrievedDocuments)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const analysisInput = [
      historyContext ? `会话历史：\n${historyContext}` : "",
      `当前用户输入：\n${normalizedInput}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let graphResult: RunAnalysisGraphOutput;
    let legacyFallbackResult: OrchestrationResult | undefined;
    let usedLocalFallback = false;
    try {
      graphResult = await withDeadline(
        runAnalysisGraph(normalizedInput, context),
        this.analysisTimeoutMs,
      );
    } catch (error) {
      if (error instanceof AnalysisDeadlineError) {
        usedLocalFallback = true;
        this.logger.warn(
          `Analysis graph exceeded ${error.timeoutMs}ms; returning local fallback`,
        );
        graphResult = localFallbackResult(normalizedInput, retrievedDocuments);
      } else {
        // 分类或模型链路整体异常时使用旧编排作为兼容降级路径；
        // 若旧编排也不可用，再返回稳定的人工审核结果，避免 HTTP 500。
        this.logger.error(
          `Analysis graph failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        if (isModelUnavailableError(error)) {
          usedLocalFallback = true;
          this.logger.warn(
            "Model gateway is unavailable; skipping legacy orchestration and using local fallback",
          );
          graphResult = localFallbackResult(
            normalizedInput,
            retrievedDocuments,
          );
        } else {
          try {
            const legacyResult = await this.orchestratorService.orchestrate(
              analysisInput,
              context,
            );
          // OrchestratorService 会把模型异常收敛成
          // `{ status: "failed", fallback: "manual_review" }`，不会继续抛出。
          // 这类结果不能当成正常的兼容响应，否则最终会把
          // “需求分析未能完成”返回给用户，绕过本地安全降级报告。
            if (
              legacyResult.status === "failed" ||
              legacyResult.fallback === "manual_review"
            ) {
              this.logger.warn(
                "Legacy orchestration returned manual_review; using local fallback",
              );
              usedLocalFallback = true;
              graphResult = localFallbackResult(
                normalizedInput,
                retrievedDocuments,
              );
            } else {
              legacyFallbackResult = legacyResult;
              graphResult = legacyResultToGraphResult(legacyResult);
            }
          } catch (legacyError) {
            this.logger.error(
              `Legacy orchestration fallback failed: ${
                legacyError instanceof Error
                  ? legacyError.message
                  : String(legacyError)
              }`,
            );
            // 两条模型编排链都不可用时，仍返回确定性的本地报告。
            // 这里不能只返回“人工审核”：那会让前端把一个可分析的需求
            // 显示成失败，并且把本轮用户体验误判成 HTTP 500。localFallbackResult
            // 不依赖外部网关，至少能给出功能分解、验收标准、复杂度和排期，
            // 同时保留 retrievedDocuments 供后续人工复核。
            graphResult = localFallbackResult(
              normalizedInput,
              retrievedDocuments,
            );
            usedLocalFallback = true;
          }
        }
      }
    }
    graphResult = normalizeGraphResult(
      graphResult,
      normalizedInput,
      retrievedDocuments,
    );
    const conclusion = analysisConclusion(graphResult);
    const clarificationQuestions = parseClarificationQuestions(
      graphResult.clarified,
    );
    const usedAgents = graphResult.steps.flatMap((step) => {
      const agentMap: Partial<Record<AnalysisGraphStep, RequirementAgentName>> = {
        extractStep: "extractAgent",
        clarifyStep: "clarifyAgent",
        analysisStep: "analysisAgent",
        riskStep: "riskAgent",
        summaryStep: "summaryAgent",
      };
      const agent = agentMap[step];
      return agent ? [agent] : [];
    });

    // 使用 DbChatHistory 写入 assistant 结果，保持 Runnable Memory 与普通
    // 会话接口共享数据源；用户消息已在模型调用前持久化，避免长请求期间丢失。
    try {
      await withDeadline(
        chatHistory.addMessage(new AIMessage(conclusion)),
        Math.min(2_000, this.retrievalTimeoutMs),
      );
    } catch (error) {
      // 模型结果已经准备好时，消息落库失败不应把用户可见响应升级成 500；
      // 下一次刷新仍可重试写入，服务端日志保留真实原因便于排查数据库状态。
      this.logger.error(
        `Assistant message persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 旧编排降级时保持历史接口的最小返回结构，兼容已有调用方；
    // 正常 LangGraph 路径则返回 intent/query/chat/steps 等扩展字段。
    if (legacyFallbackResult) {
      const fallbackReport = legacyFallbackResult.report?.trim() || conclusion;
      const compatibilityResult: AdvancedAnalysisResult = {
        report:
          legacyFallbackResult.clarificationQuestions.length > 0
            ? null
            : fallbackReport,
        status: legacyFallbackResult.status,
        fallback: legacyFallbackResult.fallback,
        intent: "analyze",
        summary: conclusion,
        usedAgents: legacyFallbackResult.usedAgents,
        retrievedDocuments,
        steps: graphResult.steps,
      };
      if (legacyFallbackResult.clarificationQuestions.length > 0) {
        compatibilityResult.clarificationQuestions =
          legacyFallbackResult.clarificationQuestions;
      }
      return compatibilityResult;
    }

    return {
      report:
        graphResult.intent === "analyze" && clarificationQuestions.length === 0
          ? graphResult.summary?.trim() || conclusion
          : null,
      status:
        usedLocalFallback
          ? "failed"
          : clarificationQuestions.length > 0
          ? "clarification_required"
          : "completed",
      fallback: usedLocalFallback ? "manual_review" : null,
      intent: graphResult.intent,
      summary: conclusion,
      clarificationQuestions,
      usedAgents,
      retrievedDocuments,
      queryResponse: graphResult.queryResponse,
      chatResponse: graphResult.chatResponse,
      steps: graphResult.steps,
    };
  }
}
