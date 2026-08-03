import {
  AIMessage,
  HumanMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { Injectable } from "@nestjs/common";
import {
  type DocumentSearchResult,
  SearchService,
} from "../document/search.service";
import { DbChatHistory } from "../message/db-chat-history";
import { MessageService } from "../message/message.service";
import {
  type RequirementAgentName,
  type OrchestrationResult,
  OrchestratorService,
} from "./agents/orchestrator.service";

export interface AdvancedAnalysisResult {
  report: string | null;
  clarificationQuestions?: string[];
  usedAgents: RequirementAgentName[];
  retrievedDocuments: DocumentSearchResult[];
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

function analysisConclusion(orchestration: OrchestrationResult): string {
  if (orchestration.report) {
    return orchestration.report;
  }
  if (orchestration.clarificationQuestions.length > 0) {
    return [
      "需要进一步澄清以下问题：",
      ...orchestration.clarificationQuestions.map((question) =>
        `- ${question}`,
      ),
    ].join("\n");
  }

  return "需求分析未能完成，任务已转入人工审核。";
}

/**
 * 统一串联 PostgreSQL 会话记忆、用户文档检索和 Multi-Agent 需求分析。
 */
@Injectable()
export class AdvancedAnalysisService {
  constructor(
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
    const history = await chatHistory.getMessages();
    const retrievedDocuments = await this.searchService.similaritySearch(
      input,
      userId,
      3,
    );
    const historyContext = history
      .map((message) => {
        const role = message.getType() === "human" ? "用户" : "助手";
        return `${role}：${contentToText(message.content)}`;
      })
      .join("\n");
    const analysisInput = [
      historyContext ? `会话历史：\n${historyContext}` : "",
      `当前用户输入：\n${input}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const retrievedContext = formatRetrievedContext(retrievedDocuments);
    const orchestration = await this.orchestratorService.orchestrate(
      analysisInput,
      retrievedContext,
    );
    const conclusion = analysisConclusion(orchestration);

    // 使用 DbChatHistory 顺序写入，保持 Runnable Memory 与普通会话接口共享数据源。
    await chatHistory.addMessages([
      new HumanMessage(input),
      new AIMessage(conclusion),
    ]);

    return {
      report: orchestration.report,
      clarificationQuestions: orchestration.clarificationQuestions,
      usedAgents: orchestration.usedAgents,
      retrievedDocuments,
    };
  }
}
