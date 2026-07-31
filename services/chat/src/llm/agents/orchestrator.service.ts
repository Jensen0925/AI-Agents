import { Injectable } from "@nestjs/common";
import {
  analysisAgent,
  clarifyAgent,
  extractAgent,
  riskAgent,
  summaryAgent,
} from "./sub-agents";

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

@Injectable()
export class OrchestratorService {
  async orchestrate(input: string): Promise<OrchestrationResult> {
    const usedAgents: RequirementAgentName[] = [];
    const steps: OrchestrationStep[] = [];
    let activeAgent: RequirementAgentName = "extractAgent";

    try {
      usedAgents.push("extractAgent");
      const extractedOutput = await extractAgent.invoke({ input });
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
      const [analysisResult, riskResult] = await Promise.allSettled([
        analysisAgent.invoke({ input, extracted: extractedJson }),
        riskAgent.invoke({ input, extracted: extractedJson }),
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
