/** Tool exposure policy: registered tools only, and unknown names fail closed. */
export type ToolLevel = "read" | "write" | "admin";

const TOOL_LEVELS: Record<string, ToolLevel> = {
  // requirement-completeness server（暴露时加 req_ 前缀）
  analyze_completeness: "read",
  estimate_complexity: "read",
  // 白名单必须覆盖 `defaultCanUseTool` 放行的全部工具：模型提示词会要求调用
  // check_conflicts / generate_user_stories / search_tech_stack，漏登记会让它们
  // 在 fail-closed 检查处被静默拒绝。改动任一份清单都要同步核对另一份，
  // 由 test/security-integration.spec.ts 的一致性用例兜住。
  check_conflicts: "read",
  generate_user_stories: "read",
  // web-search server（暴露时加 ws_ 前缀）
  search_competitors: "read",
  search_best_practices: "read",
  search_tech_stack: "read",
  // 本地工具
  search_knowledge_base: "read",
  web_search: "read",
  create_requirement: "write",
  save_report: "write",
  delete_requirement: "admin",
};

const allowlist = new Set(Object.keys(TOOL_LEVELS));

export function classify(toolName: string): ToolLevel {
  return TOOL_LEVELS[toolName] ?? "admin";
}

export function isAllowed(toolName: string): boolean {
  return allowlist.has(toolName);
}

export function requiresApproval(toolName: string): boolean {
  return classify(toolName) !== "read";
}
