import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { z as zv3 } from 'zod/v3';
import {
  bridgeMCPToLangChain,
  jsonSchemaToZod,
  serializeMCPContent,
} from '../src/mcp/mcp-to-langchain';
import type { MCPClientService, MCPToolDefinition } from '../src/mcp/mcp-client.service';

type ConnectedPair = {
  client: Client;
  close: () => Promise<void>;
};

function contentText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first?.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('Expected MCP text content');
  }
  return first.text;
}

const activeConnections: ConnectedPair[] = [];

afterEach(async () => {
  await Promise.all(activeConnections.splice(0).map(({ close }) => close()));
});

async function connectInMemory(server: McpServer): Promise<ConnectedPair> {
  const client = new Client({ name: 'chapter12-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const connection = {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
  activeConnections.push(connection);
  return connection;
}

function createRequirementServer(): McpServer {
  const server = new McpServer({ name: 'requirement-tools', version: '1.0.0' });
  const registerTool: (name: string, config: unknown, handler: (input: any) => Promise<unknown>) => void =
    server.registerTool.bind(server) as never;
  registerTool(
    'analyze_completeness',
    {
      description: '分析需求文本是否包含角色、功能和验收标准。',
      inputSchema: { requirementText: zv3.string().min(1) },
    },
    async ({ requirementText }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            score: /作为|用户/.test(requirementText) && /验收|Given/.test(requirementText) ? 100 : 50,
          }),
        },
      ],
    }),
  );
  registerTool(
    'estimate_complexity',
    {
      description: '根据需求中的集成、权限与实时特征估算复杂度。',
      inputSchema: { requirementText: zv3.string().min(1) },
    },
    async ({ requirementText }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            size: /权限|实时|集成/.test(requirementText) ? 'L' : 'S',
            estimatedDays: /权限|实时|集成/.test(requirementText) ? 10 : 2,
          }),
        },
      ],
    }),
  );
  return server;
}

function asBridgeClient(
  tools: MCPToolDefinition[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): MCPClientService {
  return {
    isConnected: () => true,
    getTools: () => tools,
    callTool,
  } as unknown as MCPClientService;
}

describe('12.4 MCP 协议层：工具逻辑', () => {
  it('通过 InMemoryTransport 发现并调用需求分析工具', async () => {
    const { client } = await connectInMemory(createRequirementServer());
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'analyze_completeness',
      'estimate_complexity',
    ]);

    const result = await client.callTool({
      name: 'analyze_completeness',
      arguments: { requirementText: '作为管理员，我需要导入数据。验收标准：错误行可下载。' },
    });
    expect(JSON.parse(contentText(result))).toEqual({ score: 100 });
  });

  it('在同一内存连接中保留工具参数与返回结果', async () => {
    const { client } = await connectInMemory(createRequirementServer());
    const result = await client.callTool({
      name: 'estimate_complexity',
      arguments: { requirementText: '需要权限控制、实时通知与第三方系统集成。' },
    });
    expect(JSON.parse(contentText(result))).toMatchObject({ size: 'L', estimatedDays: 10 });
  });
});

describe('12.5 JSON Schema 到 Zod 转换', () => {
  it('正确处理 required、optional、enum、array 与嵌套 object', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      required: ['name', 'level'],
      properties: {
        name: { type: 'string' },
        level: { type: 'string', enum: ['low', 'high'] },
        retry: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        settings: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    });

    expect(schema.parse({ name: '导入', level: 'high', tags: ['excel'], settings: { enabled: true } }))
      .toMatchObject({ name: '导入', level: 'high' });
    expect(() => schema.parse({ name: '导入', level: 'unknown' })).toThrow();
    expect(() => schema.parse({ level: 'low' })).toThrow();
  });
});

describe('12.7 多 Server 工具合并', () => {
  it('通过前缀合并多个 MCP Server 工具且能分别调用', async () => {
    const requirementClient = asBridgeClient(
      [{ name: 'analyze', description: '分析需求', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
      async (_name, args) => ({ content: [{ type: 'text', text: `analysis:${args.text}` }] }),
    );
    const searchClient = asBridgeClient(
      [{ name: 'search', description: '搜索资料', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }],
      async (_name, args) => ({ content: [{ type: 'text', text: `search:${args.query}` }] }),
    );

    const tools = [
      ...bridgeMCPToLangChain(requirementClient, 'requirements_'),
      ...bridgeMCPToLangChain(searchClient, 'web_'),
    ];
    expect(tools.map((tool) => tool.name)).toEqual(['requirements_analyze', 'web_search']);
    await expect(tools[0]!.invoke({ text: '批量导入' })).resolves.toBe('analysis:批量导入');
    await expect(tools[1]!.invoke({ query: '导入最佳实践' })).resolves.toBe('search:导入最佳实践');
  });
});

describe('12.8 MCP 错误处理', () => {
  it('未知工具返回协议错误而不是伪造成功结果', async () => {
    const { client } = await connectInMemory(createRequirementServer());
    await expect(client.callTool({ name: 'not-exist', arguments: {} })).rejects.toThrow();
  });

  it('将文本、图片和其他 content 类型稳定序列化给 LangChain', () => {
    expect(
      serializeMCPContent({
        content: [
          { type: 'text', text: '检索完成' },
          { type: 'image', mimeType: 'image/png' },
          { type: 'resource_link', uri: 'mcp://report' },
        ],
      }),
    ).toBe('检索完成\n[image: image/png]\n[resource_link]');
  });
});

describe('12.9 权限分级', () => {
  it('普通成员会收到 isError，管理员可执行敏感工具', async () => {
    const server = new McpServer({ name: 'secured-tools', version: '1.0.0' });
    const registerTool: (name: string, config: unknown, handler: (input: any) => Promise<unknown>) => void =
      server.registerTool.bind(server) as never;
    registerTool(
      'delete_requirement',
      {
        description: '删除需求（仅管理员）。',
        inputSchema: { requirementId: zv3.string(), role: zv3.enum(['member', 'admin']) },
      },
      async ({ requirementId, role }) => {
        if (role !== 'admin') {
          return { isError: true, content: [{ type: 'text' as const, text: 'forbidden: admin role required' }] };
        }
        return { content: [{ type: 'text' as const, text: `deleted:${requirementId}` }] };
      },
    );
    const { client } = await connectInMemory(server);

    const forbidden = await client.callTool({
      name: 'delete_requirement',
      arguments: { requirementId: 'REQ-1', role: 'member' },
    });
    expect(forbidden.isError).toBe(true);
    const allowed = await client.callTool({
      name: 'delete_requirement',
      arguments: { requirementId: 'REQ-1', role: 'admin' },
    });
    expect(allowed.isError).not.toBe(true);
    expect(contentText(allowed)).toBe('deleted:REQ-1');
  });
});

describe('12.10 客户端边界行为', () => {
  it('桥接器在客户端未连接时拒绝创建可调用工具', () => {
    const disconnected = {
      isConnected: () => false,
      getTools: () => [],
    } as unknown as MCPClientService;
    expect(() => bridgeMCPToLangChain(disconnected)).toThrow('MCP client is not connected');
  });

  it('无 content 时降级序列化 structuredContent', () => {
    expect(serializeMCPContent({ structuredContent: { size: 'M', days: 5 } }))
      .toBe('{"size":"M","days":5}');
  });
});
