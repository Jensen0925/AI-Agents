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
  type RequirementIntent,
  runAnalysisGraph,
  type RunAnalysisGraphOutput,
} from "./graph/requirement-analysis-graph";

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
      (document, index) =>
        `[检索文档 ${index + 1}，相关度 ${document.score.toFixed(4)}]\n${document.content}`,
    )
    .join("\n\n");
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
  if (result.chatResponse?.trim()) {
    return result.chatResponse.trim();
  }

  if (result.queryResponse?.trim()) {
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
    const chatHistory = new DbChatHistory(
      conversationId,
      this.messageService,
    );
    let history: Awaited<ReturnType<DbChatHistory["getMessages"]>> = [];
    try {
      history = await chatHistory.getMessages();
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
    await chatHistory.addMessage(new HumanMessage(input));

    let retrievedDocuments: DocumentSearchResult[] = [];
    const { retrieval } = loadLangchainConfig();
    if (retrieval.enabled) {
      try {
        retrievedDocuments = await this.searchService.similaritySearch(
          input,
          userId,
          Math.max(1, Math.floor(retrieval.topK)),
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
      `当前用户输入：\n${input}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let graphResult: RunAnalysisGraphOutput;
    let legacyFallbackResult: OrchestrationResult | undefined;
    try {
      graphResult = await runAnalysisGraph(input, context);
    } catch (error) {
      // 分类或模型链路整体异常时使用旧编排作为兼容降级路径；
      // 若旧编排也不可用，再返回稳定的人工审核结果，避免 HTTP 500。
      this.logger.error(
        `Analysis graph failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        const legacyResult = await this.orchestratorService.orchestrate(
          analysisInput,
          context,
        );
        legacyFallbackResult = legacyResult;
        graphResult = legacyResultToGraphResult(legacyResult);
      } catch (legacyError) {
        this.logger.error(
          `Legacy orchestration fallback failed: ${
            legacyError instanceof Error ? legacyError.message : String(legacyError)
          }`,
        );
        graphResult = {
          messages: [],
          intent: "analyze",
          summary: "需求分析暂时不可用，任务已转入人工审核。",
          steps: ["classifier"],
        };
      }
    }
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
    await chatHistory.addMessage(new AIMessage(conclusion));

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
        clarificationQuestions.length > 0
          ? "clarification_required"
          : "completed",
      fallback: null,
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
