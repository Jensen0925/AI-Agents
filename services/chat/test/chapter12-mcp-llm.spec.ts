import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ChatOpenAI } from '@langchain/openai';
import { afterEach, describe, expect, test } from 'bun:test';
import { z as zv3 } from 'zod/v3';
import { bridgeMCPToLangChain } from '../src/mcp/mcp-to-langchain';
import type { MCPClientService, MCPToolDefinition } from '../src/mcp/mcp-client.service';

// 真实 LLM 测试需要可用的 OPENAI_API_KEY。额外开关避免开发机虽在 .env
// 留有 Key、但网络或兼容网关不可达时，让默认离线测试套件发生外部失败。
const shouldRunLlmIntegration =
  Boolean(process.env.OPENAI_API_KEY) && process.env.RUN_LLM_MCP_TESTS === '1';
const invokedTools: string[] = [];
let client: Client | undefined;
let server: McpServer | undefined;

type ReactAgent = {
  invoke(input: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
};

type CreateReactAgent = (input: { llm: unknown; tools: unknown[] }) => ReactAgent;

// 当前 chat 服务采用 CommonJS 编译；用 require 读取实际安装的 LangGraph
// prebuilt 导出，避免 TS 在 CJS/ESM 条件导出交叉时错误地丢失 createReactAgent 类型。
const { createReactAgent } = require('@langchain/langgraph/prebuilt') as {
  createReactAgent: CreateReactAgent;
};

afterEach(async () => {
  invokedTools.length = 0;
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function createMcpAgentTools() {
  server = new McpServer({ name: 'chapter12-llm-tools', version: '1.0.0' });
  const registerTool: (name: string, config: unknown, handler: (input: any) => Promise<unknown>) => void =
    server.registerTool.bind(server) as never;
  registerTool(
    'analyze_completeness',
    { description: '分析用户需求完整度。适用于需求完整度、缺失维度与验收标准检查。', inputSchema: { requirementText: zv3.string() } },
    async ({ requirementText }) => {
      invokedTools.push('analyze_completeness');
      return { content: [{ type: 'text' as const, text: `完整度分析：${requirementText}，缺少非功能需求。` }] };
    },
  );
  registerTool(
    'search_best_practices',
    { description: '搜索最佳实践。适用于查询批量导入、权限、实时通信等设计方案。', inputSchema: { topic: zv3.string() } },
    async ({ topic }) => {
      invokedTools.push('search_best_practices');
      return { content: [{ type: 'text' as const, text: `最佳实践：${topic}应支持预校验、错误报告和异步任务。` }] };
    },
  );
  registerTool(
    'estimate_complexity',
    { description: '估算需求复杂度和开发人天。适用于需求排期和技术复杂度评估。', inputSchema: { requirementText: zv3.string() } },
    async ({ requirementText }) => {
      invokedTools.push('estimate_complexity');
      return { content: [{ type: 'text' as const, text: `复杂度：L，预计 10 人天。需求：${requirementText}` }] };
    },
  );

  client = new Client({ name: 'chapter12-llm-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const bridgeClient = {
    isConnected: () => true,
    getTools: () => listed.tools as MCPToolDefinition[],
    callTool: (name: string, args: Record<string, unknown>) => client!.callTool({ name, arguments: args }),
  } as unknown as MCPClientService;

  return bridgeMCPToLangChain(bridgeClient, 'mcp_');
}

function createRealAgent(tools: ReturnType<typeof bridgeMCPToLangChain>): ReactAgent {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? 'gpt-5.6-terra',
    modelKwargs: { reasoning_effort: 'high' },
    temperature: 0,
    timeout: 60_000,
    maxRetries: 1,
    configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
  });
  return createReactAgent({ llm: model, tools });
}

describe('第十二章 Layer 2：LLM 与 MCP 集成（需要 OPENAI_API_KEY）', () => {
  test.skipIf(!shouldRunLlmIntegration)('12.11 Agent 能自主选择正确的 MCP 工具', async () => {
    const tools = await createMcpAgentTools();
    const agent = createRealAgent(tools);
    await agent.invoke({
      messages: [
        {
          role: 'user',
          content: '请调用最合适的工具检查这条需求是否完整：作为管理员，我需要批量导入 Excel 数据。',
        },
      ],
    });
    expect(invokedTools).toContain('analyze_completeness');
  }, 90_000);

  test.skipIf(!shouldRunLlmIntegration)('12.12 Agent 能协同 analyze、search 与 estimate 三个 MCP 工具', async () => {
    const tools = await createMcpAgentTools();
    const agent = createRealAgent(tools);
    await agent.invoke({
      messages: [
        {
          role: 'user',
          content:
            '请依次调用需求完整度分析、批量导入最佳实践搜索和复杂度估算三个工具，评估“管理员批量导入 Excel 数据，并显示失败行”的需求；最后简要汇总。',
        },
      ],
    });
    expect(invokedTools).toEqual(
      expect.arrayContaining([
        'analyze_completeness',
        'search_best_practices',
        'estimate_complexity',
      ]),
    );
  }, 90_000);
});
