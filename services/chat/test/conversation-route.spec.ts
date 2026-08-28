import { describe, expect, it } from "vitest";
import {
  classifyConversationRoute,
  isRequirementFollowupAnswer,
  isUiRequirementFlowStart,
} from "../src/llm/conversation-route";

describe("conversation route boundaries", () => {
  it("routes general technical questions directly to the model", () => {
    expect(classifyConversationRoute("查询一下 React 是什么")).toBe(
      "direct",
    );
    expect(classifyConversationRoute("前端 React 是什么")).toBe("direct");
    expect(classifyConversationRoute("React 和 Vue 有什么区别？")).toBe(
      "direct",
    );
    expect(classifyConversationRoute("什么是需求分析报告？")).toBe("direct");
    expect(classifyConversationRoute("如何进行需求分析？")).toBe("direct");
  });

  it("uses retrieval only when the user explicitly refers to internal knowledge", () => {
    expect(classifyConversationRoute("根据知识库查询退换货政策")).toBe(
      "knowledge",
    );
    expect(classifyConversationRoute("公司制度里如何规定退款？")).toBe(
      "knowledge",
    );
    expect(classifyConversationRoute("查询需求规范")).toBe("knowledge");
    expect(
      classifyConversationRoute("根据知识库查询 REQ-20240815-002 的状态"),
    ).toBe("requirement_query");
  });

  it("separates new requirements from existing requirement queries", () => {
    expect(classifyConversationRoute("我需要一个用户登录功能")).toBe(
      "requirement_analysis",
    );
    expect(classifyConversationRoute("请分析登录需求并输出验收标准")).toBe(
      "requirement_analysis",
    );
    expect(classifyConversationRoute("查询 REQ-20240815-002 的进度")).toBe(
      "requirement_query",
    );
    expect(
      classifyConversationRoute("查询 REQ-20240815-002 的需求分析报告"),
    ).toBe("requirement_query");
    expect(
      classifyConversationRoute(
        "分析需求 REQ-20240815-002：开发在线问卷系统",
      ),
    ).toBe("requirement_analysis");
  });

  it("inherits only short non-question answers during requirement clarification", () => {
    expect(isRequirementFollowupAnswer("管理员和普通用户")).toBe(true);
    expect(isRequirementFollowupAnswer("React 是什么？")).toBe(false);
  });

  it("starts UI flow only for explicit create-requirement commands", () => {
    expect(isUiRequirementFlowStart("我要提一个新需求：批量导入 Excel")).toBe(
      true,
    );
    expect(isUiRequirementFlowStart("新需求是什么？")).toBe(false);
    expect(isUiRequirementFlowStart("查看需求 REQ-2026-001")).toBe(false);
  });
});
