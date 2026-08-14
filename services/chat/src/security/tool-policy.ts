/** Tool exposure policy: registered tools only, and unknown names fail closed. */
export type ToolLevel = "read" | "write" | "admin";

const TOOL_LEVELS: Record<string, ToolLevel> = {
  analyze_completeness: "read",
  estimate_complexity: "read",
  search_competitors: "read",
  search_best_practices: "read",
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
