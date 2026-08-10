import { Injectable } from "@nestjs/common";
import {
  analysisAgent,
  clarifyAgent,
  extractAgent,
  riskAgent,
  summaryAgent,
} from "./sub-agents";
import type { AIUIResponse, UIStep } from "../ui-protocol/ui-types";
import type { ExpertName } from "../graph/experts";

export type RequirementAgentName =
  | "extractAgent"
  | "clarifyAgent"
  | "analysisAgent"
  | "riskAgent"
  | "summaryAgent";

export interface OrchestrationStep {
  agent: RequirementAgentName;
  status: "completed" | "failed";
  output?: unknown;
  error?: string;
}

export interface OrchestrationResult {
  mode: "fixed";
  status: "completed" | "clarification_required" | "failed";
  clarificationQuestions: string[];
  usedAgents: RequirementAgentName[];
  fallback: "manual_review" | null;
  steps: OrchestrationStep[];
  report: string | null;
  /** Supervisor 实际调度的专项专家（可选，兼容固定编排调用方）。 */
  activeExperts?: ExpertName[];
  /** 流程因澄清或人工介入暂停时置为 true。 */
  interrupted?: boolean;
}

interface ClarificationDecision {
  needsClarification: boolean;
  questions: string[];
}

function normalizeJsonOutput(output: string): string {
  const trimmed = output.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error("Agent did not return a JSON object");
  }

  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function parseObject(output: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(normalizeJsonOutput(output));

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Agent JSON output must be an object");
  }

  return parsed as Record<string, unknown>;
}

function parseClarification(output: string): ClarificationDecision {
  const parsed = parseObject(output);
  if (
    typeof parsed.needsClarification !== "boolean" ||
    !Array.isArray(parsed.questions) ||
    !parsed.questions.every((question) => typeof question === "string")
  ) {
    throw new Error("Clarify Agent returned an invalid JSON schema");
  }

  const questions = parsed.questions
    .map((question) => question.trim())
    .filter(Boolean);
  if (parsed.needsClarification && questions.length === 0) {
    throw new Error("Clarify Agent requested clarification without questions");
  }

  return {
    needsClarification: parsed.needsClarification,
    questions,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown agent failure";
}

/**
 * 按固定顺序协调五个需求分析 Agent，并记录每一步的输入输出状态。
 * 澄清阶段可提前终止；任一核心分析失败时统一降级为人工审核。
 */
@Injectable()
export class OrchestratorService {
  /** 将编排结果转换为前端可直接渲染的 UI 协议。 */
  toUIResponse(result: OrchestrationResult): AIUIResponse {
    const components: AIUIResponse["components"] = [];
    if (result.interrupted || result.status === "clarification_required") {
      components.push({
        type: "confirmation",
        id: "human-review-confirmation",
        title: "需要确认后继续",
        summary:
          result.clarificationQuestions.length > 0
            ? result.clarificationQuestions
            : "分析流程已暂停，请确认是否交由人工补充。",
        confirmLabel: "继续分析",
        cancelLabel: "转人工审核",
        confirmAction: "resume_analysis",
        cancelAction: "manual_review",
      });
    }

    const experts = [...new Set(result.activeExperts ?? [])].slice(0, 4);
    const expertSteps: UIStep[] = experts.map((expert, index) => ({
      key: `${expert}_expert`,
      label: `${expert}_expert`,
      status:
        result.status === "completed"
          ? "completed"
          : index === 0
            ? "current"
            : "pending",
    }));
    if (expertSteps.length > 0) {
      components.push({
        type: "steps",
        id: "analysis-experts",
        title: "专家分析进度",
        current: Math.max(
          0,
          expertSteps.findIndex((step) => step.status === "current"),
        ),
        steps: expertSteps,
      });
    }

    if (result.report) {
      components.push({ type: "text", content: result.report, markdown: true });
    }
    if (components.length === 0) {
      components.push({
        type: "text",
        content:
          result.fallback === "manual_review"
            ? "分析暂时不可用，已转人工审核。"
            : "暂无可展示结果。",
      });
    }
    return { components };
  }

  /** 执行“抽取 → 澄清 → 并行分析/风控 → 汇总”的固定工作流。 */
  async orchestrate(
    input: string,
    retrievedContext = "当前用户知识库没有检索到相关文档。",
  ): Promise<OrchestrationResult> {
    const usedAgents: RequirementAgentName[] = [];
    const steps: OrchestrationStep[] = [];
    let activeAgent: RequirementAgentName = "extractAgent";

    try {
      usedAgents.push("extractAgent");
      const extractedOutput = await extractAgent.invoke({
        input,
        retrievedContext,
      });
      const extracted = parseObject(extractedOutput);
      const extractedJson = JSON.stringify(extracted, null, 2);
      steps.push({
        agent: "extractAgent",
        status: "completed",
        output: extracted,
      });

      activeAgent = "clarifyAgent";
      usedAgents.push("clarifyAgent");
      const clarifyOutput = await clarifyAgent.invoke({
        input,
        extracted: extractedJson,
        retrievedContext,
      });
      const clarification = parseClarification(clarifyOutput);
      steps.push({
        agent: "clarifyAgent",
        status: "completed",
        output: clarification,
      });

      if (clarification.needsClarification) {
        return {
          mode: "fixed",
          status: "clarification_required",
          clarificationQuestions: clarification.questions,
          usedAgents,
          fallback: null,
          steps,
          report: null,
        };
      }

      usedAgents.push("analysisAgent", "riskAgent");
      // 分析与风控只依赖抽取结果，可并行执行以降低整体响应时间。
      const [analysisResult, riskResult] = await Promise.allSettled([
        analysisAgent.invoke({
          input,
          extracted: extractedJson,
          retrievedContext,
        }),
        riskAgent.invoke({
          input,
          extracted: extractedJson,
          retrievedContext,
        }),
      ]);

      if (analysisResult.status === "fulfilled") {
        steps.push({
          agent: "analysisAgent",
          status: "completed",
          output: analysisResult.value,
        });
      } else {
        steps.push({
          agent: "analysisAgent",
          status: "failed",
          error: errorMessage(analysisResult.reason),
        });
      }

      if (riskResult.status === "fulfilled") {
        steps.push({
          agent: "riskAgent",
          status: "completed",
          output: riskResult.value,
        });
      } else {
        steps.push({
          agent: "riskAgent",
          status: "failed",
          error: errorMessage(riskResult.reason),
        });
      }

      if (
        analysisResult.status === "rejected" ||
        riskResult.status === "rejected"
      ) {
        return {
          mode: "fixed",
          status: "failed",
          clarificationQuestions: [],
          usedAgents,
          fallback: "manual_review",
          steps,
          report: null,
        };
      }

      activeAgent = "summaryAgent";
      usedAgents.push("summaryAgent");
      const report = await summaryAgent.invoke({
        input,
        extracted: extractedJson,
        analysis: analysisResult.value,
        risks: riskResult.value,
        retrievedContext,
      });
      steps.push({
        agent: "summaryAgent",
        status: "completed",
        output: report,
      });

      return {
        mode: "fixed",
        status: "completed",
        clarificationQuestions: [],
        usedAgents,
        fallback: null,
        steps,
        report,
      };
    } catch (error) {
      // 捕获解析、模型和汇总异常，保持编排接口返回结构稳定。
      if (!steps.some((step) => step.agent === activeAgent)) {
        steps.push({
          agent: activeAgent,
          status: "failed",
          error: errorMessage(error),
        });
      }

      return {
        mode: "fixed",
        status: "failed",
        clarificationQuestions: [],
        usedAgents,
        fallback: "manual_review",
        steps,
        report: null,
      };
    }
  }
}
