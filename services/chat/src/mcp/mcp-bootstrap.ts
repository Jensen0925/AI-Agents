import { resolve } from "node:path";
import { MCPClientService } from "./mcp-client.service";
import { MCPManager, createUnavailableMCPClient } from "./mcp-manager";

/** 进程级 MCP 管理器。专家图读取它提供的、经权限与意图裁剪的工具。 */
export const mcpManager = new MCPManager();

let initialization: Promise<void> | undefined;
let registered = false;

function repositoryRoot(): string {
  return process.cwd().endsWith("/services/chat")
    ? resolve(process.cwd(), "../..")
    : process.cwd();
}

function registerServers(): void {
  if (registered) return;

  const root = repositoryRoot();
  mcpManager
    .registerServer({
      name: "requirement-analyzer",
      prefix: "req_",
      client: new MCPClientService({
        command: "bun",
        args: [
          resolve(root, "services/mcp-requirement-completeness/src/index.ts"),
        ],
      }),
    })
    .registerServer({
      name: "web-search",
      prefix: "ws_",
      client: new MCPClientService({
        command: "bun",
        args: [resolve(root, "mcp-servers/web-search/src/index.ts")],
      }),
    })
    .registerServer({
      name: "rag-server",
      allowedTools: ["search_knowledge_base"],
      client: createUnavailableMCPClient("rag-server is not configured", [
        {
          name: "search_knowledge_base",
          description:
            "检索当前用户知识库。适用于需要引用内部文档、制度或历史资料的问题；不适用于无资料依据的闲聊。",
          inputSchema: {
            type: "object",
            required: ["question"],
            properties: {
              question: { type: "string" },
              topK: { type: "integer" },
            },
          },
        },
      ]),
    });
  registered = true;
}

/**
 * 尽力连接所有 MCP Server。连接失败被 MCPManager 记录，调用方始终可以使用本地工具。
 * 多次调用复用同一个初始化 Promise，避免 Nest 热重载时重复注册 Server。
 */
export function initMcp(): Promise<void> {
  if (initialization) return initialization;
  registerServers();
  initialization = mcpManager.connectAll().catch((error) => {
    console.warn(
      "[MCP] startup connection failed; local expert tools remain active:",
      error instanceof Error ? error.message : error,
    );
  });
  return initialization;
}

export async function closeMcp(): Promise<void> {
  await mcpManager.closeAll();
  initialization = undefined;
}
