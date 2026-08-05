import {
  AIMessage,
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

function localFallbackResult(
  input: string,
  retrievedDocuments: DocumentSearchResult[],
): RunAnalysisGraphOutput {
  const intent = classifyIntentByKeywords(input);

  if (intent === "chat") {
    const response =
      "你好！我是 CloudSage 需求分析助手，可以协助需求拆解、风险评估和知识库查询。";
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
   * 默认给完整图 8 秒，保证浏览器端不会长时间卡住。
   * 可通过 CHAT_ANALYSIS_TIMEOUT_MS 调整；0 或负数表示不启用总时限。
   */
  private readonly analysisTimeoutMs = Number(
    process.env["CHAT_ANALYSIS_TIMEOUT_MS"] ?? 8_000,
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
