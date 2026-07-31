import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  type OrchestrationResult,
  OrchestratorService,
} from "./agents/orchestrator.service";
import { FilesystemService } from "./filesystem/filesystem.service";
import { RunnableMemoryService } from "./memory/runnable-memory.service";

export interface AdvancedAnalysisResult extends OrchestrationResult {
  sessionId: string;
  reportPath: string | null;
}

function createReportPath(sessionId: string): string {
  const reportId = /^[A-Za-z0-9_-]+$/.test(sessionId)
    ? sessionId
    : createHash("sha256").update(sessionId).digest("hex").slice(0, 16);

  return `reports/${reportId}-analysis.md`;
}

@Injectable()
export class AdvancedAnalysisService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly memoryService: RunnableMemoryService,
    private readonly filesystemService: FilesystemService,
  ) {}

  async analyze(
    sessionId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    const history = await this.memoryService.getHistory(sessionId);
    const analysisInput =
      history.length === 0
        ? input
        : [
            "以下是同一需求会话的已确认上下文：",
            ...history.map(
              (message) => `${message.role === "human" ? "用户" : "助手"}：${message.content}`,
            ),
            `用户当前请求：${input}`,
          ].join("\n");
    const orchestration = await this.orchestratorService.orchestrate(
      analysisInput,
    );

    if (orchestration.status === "clarification_required") {
      return {
        ...orchestration,
        sessionId,
        reportPath: null,
      };
    }

    if (orchestration.status !== "completed" || !orchestration.report) {
      return {
        ...orchestration,
        sessionId,
        reportPath: null,
      };
    }

    const reportPath = createReportPath(sessionId);
    await this.filesystemService.writeFile(reportPath, orchestration.report);
    // 直接写入本轮问答，避免 Memory 服务为了保存结论再次调用模型。
    await this.memoryService.appendMessage(
      sessionId,
      input,
      orchestration.report,
    );

    return {
      ...orchestration,
      sessionId,
      reportPath,
    };
  }
}
