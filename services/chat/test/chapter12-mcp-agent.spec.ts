import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  MCPManager,
  type MCPToolClient,
} from '../src/mcp/mcp-manager';
import type { MCPToolDefinition } from '../src/mcp/mcp-client.service';
import {
  createMcpFunctionalExpert,
  FUNCTIONAL_MCP_AGENT_PROMPT,
} from '../src/llm/graph/mcp-functional-expert';

type RecordedCall = { name: string; args: Record<string, unknown> };

function toolDefinition(name: string, description: string, field: string): MCPToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      required: [field],
      properties: { [field]: { type: 'string' } },
    },
  };
}

function createMockClient(
  tools: MCPToolDefinition[],
  calls: RecordedCall[],
  responses: Record<string, string>,
  options: { fail?: string[]; connectFails?: boolean } = {},
): MCPToolClient {
  let connected = false;
  return {
    connect: async () => {
      if (options.connectFails) throw new Error('mock server unavailable');
      connected = true;
    },
    close: async () => {
      connected = false;
    },
    isConnected: () => connected,
    getTools: () => tools,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (options.fail?.includes(name)) throw new Error(`forced ${name} failure`);
      return { content: [{ type: 'text', text: responses[name] ?? JSON.stringify({ name, args }) }] };
    },
  };
}

function createManager(
  calls: RecordedCall[],
  options: { failEstimate?: boolean; canUseTool?: (userId: string, toolName: string) => boolean } = {},
) {
  const fallbackEstimate = tool(
    async ({ requirementText }) => JSON.stringify({ source: 'fallback', estimated: requirementText.length }),
    {
      name: 'estimate_complexity',
      description: '本地复杂度估算降级工具。',
      schema: z.object({ requirementText: z.string() }),
    },
  );
  const manager = new MCPManager({
    fallbackTools: [fallbackEstimate],
    canUseTool: options.canUseTool,
    logger: { warn: () => undefined },
  });
  manager
    .registerServer({
      name: 'requirement-analyzer',
      prefix: 'req_',
      client: createMockClient(
        [
          toolDefinition('analyze_completeness', '分析需求六维完整度。', 'requirementText'),
          toolDefinition('estimate_complexity', '估算实现复杂度和人天。', 'requirementText'),
        ],
        calls,
        {
          analyze_completeness: JSON.stringify({ completenessScore: 83 }),
          estimate_complexity: JSON.stringify({ size: 'L', estimatedDays: 10 }),
        },
        { fail: options.failEstimate ? ['estimate_complexity'] : [] },
      ),
    })
    .registerServer({
      name: 'web-search',
      prefix: 'ws_',
      client: createMockClient(
        [toolDefinition('search_best_practices', '检索功能设计最佳实践。', 'topic')],
        calls,
        { search_best_practices: JSON.stringify({ results: ['异步导入 + 错误报告'] }) },
      ),
    })
    .registerServer({
      name: 'rag-server',
      allowedTools: ['search_knowledge_base'],
      client: createMockClient(
        [toolDefinition('search_knowledge_base', '检索内部知识库资料。', 'question')],
        calls,
        { search_knowledge_base: JSON.stringify({ citations: ['doc-1#chunk-2'] }) },
      ),
    });
  return manager;
}

describe('12.13 MCP Manager 与 LangGraph 功能专家集成', () => {
  it('连接三台 Server 后，analyze 意图获得 analyze、RAG、web search、estimate 工具并完成协同调用', async () => {
    const calls: RecordedCall[] = [];
    const manager = createManager(calls);
    await manager.connectAll();

    const tools = manager.getTools({ userId: 'user-1', intent: 'analyze' });
    expect(tools.map((item) => item.name)).toEqual([
      'req_analyze_completeness',
      'req_estimate_complexity',
      'ws_search_best_practices',
      'search_knowledge_base',
    ]);

    const byName = new Map(tools.map((item) => [item.name, item]));
    const requirementText = '管理员需要批量导入 Excel 数据，并提供错误行下载。';
    await byName.get('req_analyze_completeness')!.invoke({ requirementText });
    await byName.get('search_knowledge_base')!.invoke({ question: '批量导入历史规范' });
    await byName.get('ws_search_best_practices')!.invoke({ topic: 'Excel 批量导入' });
    await byName.get('req_estimate_complexity')!.invoke({ requirementText });

    expect(calls.map((call) => call.name)).toEqual([
      'analyze_completeness',
      'search_knowledge_base',
      'search_best_practices',
      'estimate_complexity',
    ]);
    expect(manager.getTraces().filter((trace) => trace.status === 'completed')).toHaveLength(4);
  });

  it('按 intent 裁剪：query 保留需求/RAG，chat 不把 MCP 工具送入上下文', async () => {
    const manager = createManager([]);
    await manager.connectAll();

    expect(manager.getTools({ userId: 'user-1', intent: 'query' }).map((item) => item.name)).toEqual([
      'req_analyze_completeness',
      'req_estimate_complexity',
      'search_knowledge_base',
    ]);
    expect(manager.getTools({ userId: 'user-1', intent: 'chat' })).toEqual([]);
  });

  it('权限必须在 MCP 调用前拦截，拒绝后不触发远端工具', async () => {
    const calls: RecordedCall[] = [];
    const manager = createManager(calls, { canUseTool: (_userId, name) => name !== 'ws_search_best_practices' });
    await manager.connectAll();

    const result = await manager.callTool('user-1', 'ws_search_best_practices', { topic: '导入设计' });
    expect(JSON.parse(result)).toMatchObject({ error: 'permission_denied' });
    expect(calls).toHaveLength(0);
    expect(manager.getTraces().at(-1)).toMatchObject({ status: 'denied', toolName: 'ws_search_best_practices' });
  });

  it('MCP 工具不可用时执行 fallbackTools，并记录 failed 与 fallback trace', async () => {
    const calls: RecordedCall[] = [];
    const manager = createManager(calls, { failEstimate: true });
    await manager.connectAll();

    const result = await manager.callTool('user-1', 'req_estimate_complexity', { requirementText: '需要实时权限同步' });
    expect(JSON.parse(result)).toMatchObject({ source: 'fallback' });
    expect(calls).toEqual([{ name: 'estimate_complexity', args: { requirementText: '需要实时权限同步' } }]);
    expect(manager.getTraces().map((trace) => trace.status)).toEqual(['failed', 'fallback']);
  });

  it('功能专家工厂把三项本地工具与已裁剪 MCP 工具按指定顺序合并，并传入 React prompt', async () => {
    const calls: RecordedCall[] = [];
    const manager = createManager(calls);
    let captured: { tools: StructuredToolInterface[]; prompt: string } | undefined;
    const created = await createMcpFunctionalExpert({
      manager,
      userId: 'user-1',
      intent: 'analyze',
      llm: { fake: true },
      createAgent: ({ tools, prompt }) => {
        captured = { tools, prompt };
        return { invoke: async () => ({ ok: true }) };
      },
    });

    expect(created.tools.slice(0, 3).map((item) => item.name)).toEqual([
      'read_requirement',
      'check_existing_features',
      'load_perf_baseline',
    ]);
    expect(created.tools.map((item) => item.name)).toContain('search_knowledge_base');
    expect(captured?.prompt).toBe(FUNCTIONAL_MCP_AGENT_PROMPT);
  });
});
