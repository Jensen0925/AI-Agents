import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

type SearchIntent = "competitors" | "best_practices" | "tech_stack";

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
  }>;
}

const MOCK_RESULTS: Record<"bulk-import" | "permission" | "realtime", SearchResult[]> = {
  "bulk-import": [
    {
      title: "Bulk import design: validation, preview, and rollback",
      snippet:
        "A robust bulk import flow validates rows before writing, shows a preview of failures, processes data asynchronously, and lets users download an error report for correction.",
      url: "https://example.com/practices/bulk-import-validation",
    },
    {
      title: "CSV and Excel imports at scale",
      snippet:
        "Use template downloads, idempotency keys, chunked processing, progress notifications, and a dead-letter path for invalid records when importing large spreadsheet files.",
      url: "https://example.com/techniques/spreadsheet-imports",
    },
    {
      title: "Competitor pattern: import job center",
      snippet:
        "Many B2B products expose import history, per-row errors, retry controls, and audit logs instead of treating an upload as a synchronous one-shot operation.",
      url: "https://example.com/competitors/import-job-center",
    },
  ],
  permission: [
    {
      title: "RBAC permission design for SaaS products",
      snippet:
        "Model permissions as action-resource pairs, group them by role, enforce checks on the server, and keep UI visibility separate from real authorization decisions.",
      url: "https://example.com/practices/rbac-design",
    },
    {
      title: "Permission matrix and least privilege",
      snippet:
        "Start with a permission matrix, assign the smallest viable permission set, add scoped data access where needed, and record privileged changes in an audit log.",
      url: "https://example.com/security/least-privilege",
    },
    {
      title: "Competitor pattern: role templates plus custom roles",
      snippet:
        "Enterprise products commonly combine preset roles for quick onboarding with custom roles, permission search, and impact warnings before permission changes are saved.",
      url: "https://example.com/competitors/role-management",
    },
  ],
  realtime: [
    {
      title: "Choosing WebSocket, SSE, and polling for real-time updates",
      snippet:
        "Use SSE for server-to-client notifications, WebSocket for low-latency bidirectional collaboration, and polling only when update frequency and interaction needs are limited.",
      url: "https://example.com/architecture/realtime-transport",
    },
    {
      title: "Reliable real-time notification architecture",
      snippet:
        "Separate event production from delivery using a durable queue, include event IDs for deduplication, and allow reconnecting clients to retrieve missed history.",
      url: "https://example.com/practices/realtime-notifications",
    },
    {
      title: "Competitor pattern: activity feed with live updates",
      snippet:
        "Modern SaaS applications pair live notification delivery with an inbox, read state, retryable events, and a persistent activity timeline for offline users.",
      url: "https://example.com/competitors/live-activity-feed",
    },
  ],
};

function detectMockScenario(query: string): keyof typeof MOCK_RESULTS {
  const normalized = query.toLowerCase();
  if (
    /(批量导入|导入|excel|csv|spreadsheet|bulk\s*import|upload)/i.test(
      normalized,
    )
  ) {
    return "bulk-import";
  }
  if (
    /(权限|角色|鉴权|认证|rbac|permission|role|access\s*control)/i.test(
      normalized,
    )
  ) {
    return "permission";
  }
  if (
    /(实时|推送|通知|websocket|sse|realtime|real-time|streaming)/i.test(
      normalized,
    )
  ) {
    return "realtime";
  }
  return "bulk-import";
}

export function searchMock(query: string, intent: SearchIntent): SearchResult[] {
  const scenario = detectMockScenario(query);
  const results = MOCK_RESULTS[scenario];

  // 保持返回稳定，但将最贴合当前工具意图的参考资料排在前面。
  const hint = intent === "competitors" ? "Competitor" : intent === "best_practices" ? "practice" : "Choosing";
  return [...results].sort((left, right) => {
    const leftScore = left.title.toLowerCase().includes(hint.toLowerCase()) ? 1 : 0;
    const rightScore = right.title.toLowerCase().includes(hint.toLowerCase()) ? 1 : 0;
    return rightScore - leftScore;
  });
}

export async function searchWithTavily(
  query: string,
  maxResults = 5,
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // 密钥只走 Authorization 头：放进 body 会被网关、代理与请求日志一并记录。
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily Search API request failed (${response.status})`);
  }

  const body = (await response.json()) as TavilySearchResponse;
  return (body.results ?? [])
    .filter((result): result is Required<TavilySearchResponse>["results"][number] => Boolean(result.title && result.content && result.url))
    .map((result) => ({
      title: result.title!,
      snippet: result.content!,
      url: result.url!,
    }));
}

/**
 * 本轮搜索结果的来源。
 * - `tavily`：真实检索结果，可作为证据引用。
 * - `mock`：未配置密钥时的确定性占位数据。
 * - `unavailable`：配置了密钥但请求失败，本轮没有结果。
 */
export type SearchSource = "tavily" | "mock" | "unavailable";

export interface WebSearchOutcome {
  source: SearchSource;
  results: SearchResult[];
  /** 非空表示本轮没有可用的真实检索结果。 */
  error?: string;
}

/**
 * 执行一次网页搜索。
 *
 * 只有 Tavily 返回的结果才能作为真实证据：未配置密钥时返回占位数据并标注
 * `error`；配置了但请求失败时返回空结果，**不**回退到占位数据——否则模型会把
 * 编造的 example.com 链接当成真实竞品/实践证据写进结论。
 */
export async function searchWeb(
  query: string,
  intent: SearchIntent,
): Promise<WebSearchOutcome> {
  if (!process.env.TAVILY_API_KEY) {
    return {
      source: "mock",
      results: searchMock(query, intent),
      error:
        "TAVILY_API_KEY is not configured; results are deterministic placeholder data, not real search results",
    };
  }

  try {
    return { source: "tavily", results: await searchWithTavily(query) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[web-search] Tavily search failed: ${reason}`);
    return {
      source: "unavailable",
      results: [],
      error: `Tavily search failed: ${reason}`,
    };
  }
}

function toTextResponse(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

/**
 * 把搜索结果包装成 MCP 响应。
 *
 * 结果不是真实检索数据时，除了在 JSON 里带 `error`，还要标记 `isError`：
 * 调用方（MCPManager）会把工具错误记录下来，模型也就不会把占位数据
 * 当作真实证据使用。
 */
function toSearchResponse(outcome: WebSearchOutcome) {
  const payload = {
    source: outcome.source,
    results: outcome.results,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
  const response = toTextResponse(payload);
  if (!outcome.error) return response;
  return { ...response, isError: true };
}

const server = new McpServer({
  name: "web-search",
  version: "0.1.0",
});

server.registerTool(
  "search_competitors",
  {
    title: "搜索竞品功能",
    description: "搜索竞品在指定功能或产品领域中的实现模式。",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(200)
        .describe("要调研的功能、产品或竞品问题"),
      domain: z
        .string()
        .max(100)
        .optional()
        .describe("可选的业务领域，例如 SaaS、电商或协同办公"),
    },
  },
  async ({ query, domain }) =>
    toSearchResponse(
      await searchWeb(`${query}${domain ? ` ${domain}` : ""} competitor features`, "competitors"),
    ),
);

server.registerTool(
  "search_best_practices",
  {
    title: "搜索最佳实践",
    description: "搜索一个主题在指定行业中的设计、工程或产品最佳实践。",
    inputSchema: {
      topic: z.string().min(1).max(200).describe("要检索的实践主题"),
      industry: z
        .string()
        .max(100)
        .optional()
        .describe("可选的行业，例如金融、医疗或 SaaS"),
    },
  },
  async ({ topic, industry }) =>
    toSearchResponse(
      await searchWeb(`${topic}${industry ? ` ${industry}` : ""} best practices`, "best_practices"),
    ),
);

server.registerTool(
  "search_tech_stack",
  {
    title: "搜索技术选型",
    description: "搜索某项技术在目标用例中的架构选择、实现模式和权衡。",
    inputSchema: {
      technology: z.string().min(1).max(200).describe("待评估的技术、框架或协议"),
      useCase: z
        .string()
        .max(200)
        .optional()
        .describe("可选的目标用例或业务场景"),
    },
  },
  async ({ technology, useCase }) =>
    toSearchResponse(
      await searchWeb(`${technology}${useCase ? ` ${useCase}` : ""} technology stack`, "tech_stack"),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
