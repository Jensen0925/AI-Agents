import { DynamicStructuredTool, tool, type StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import {
  MCPManager,
  createUnavailableMCPClient,
  type MCPToolIntent,
  type MCPManagerOptions,
} from '../../mcp/mcp-manager';
import { MCPClientService, type MCPClientConfig } from '../../mcp/mcp-client.service';

type ReactAgent = {
  invoke(input: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
};
type CreateReactAgent = (input: {
  llm: unknown;
  tools: StructuredToolInterface[];
  prompt: string;
}) => ReactAgent;

// chat 服务仍使用 CommonJS 编译，require 可规避 LangGraph prebuilt 的条件导出类型问题。
const { createReactAgent } = require('@langchain/langgraph/prebuilt') as {
  createReactAgent: CreateReactAgent;
};

/** 本地基础工具：MCP 离线或工具故障时，Agent 仍能完成最小分析闭环。 */
export const readRequirementTool = tool(
  async ({ requirementId }) => JSON.stringify({ requirementId, source: 'local-fallback', status: 'draft' }),
  {
    name: 'read_requirement',
    description: '读取指定需求编号的本地基础信息，适用于已有需求查询。',
    schema: z.object({ requirementId: z.string().min(1) }),
  },
);

export const checkExistingFeaturesTool = tool(
  async ({ description }) => JSON.stringify({ description, matchedFeatures: [], source: 'local-fallback' }),
  {
    name: 'check_existing_features',
    description: '检查需求描述与现有功能的潜在重叠，适用于冲突或重复功能分析。',
    schema: z.object({ description: z.string().min(1) }),
  },
);

export const loadPerfBaselineTool = tool(
  async ({ scenario }) => JSON.stringify({ scenario, baseline: '暂无线上基线，需在评审中补充 QPS、延迟和容量目标。' }),
  {
    name: 'load_perf_baseline',
    description: '读取性能基线，适用于并发、延迟、吞吐和容量需求分析。',
    schema: z.object({ scenario: z.string().min(1) }),
  },
);

export const FUNCTIONAL_MCP_AGENT_PROMPT = `你是功能需求专家。可使用本地工具和 MCP 工具完成需求分析：
- req_ 前缀：需求完整度、复杂度、冲突和用户故事，适用于分析需求文本。
- ws_ 前缀：竞品、最佳实践、技术选型，适用于需要外部设计参考时。
- search_knowledge_base：检索当前用户知识库，适用于需要引用内部资料时。
- 本地 read_requirement/check_existing_features/load_perf_baseline：MCP 不可用时的基础兜底。

先依据问题选择最少且相关的工具；不要在闲聊中调用工具，也不要以相同参数重复调用。工具信息足够后，用 Markdown 输出功能范围、用户故事、验收标准、依赖与待确认项。`;

export interface McpFunctionalExpertOptions {
  manager: MCPManager;
  userId: string;
  intent?: MCPToolIntent;
  llm?: unknown;
  createAgent?: CreateReactAgent;
}

export interface McpFunctionalExpert {
  agent: ReactAgent;
  tools: StructuredToolInterface[];
}

/**
 * 以 createReactAgent 组装“本地功能工具 + 经权限/意图过滤的 MCP 工具”。
 * 默认模型严格遵循本节示例；生产环境可从 model config 注入替换。
 */
export async function createMcpFunctionalExpert(
  options: McpFunctionalExpertOptions,
): Promise<McpFunctionalExpert> {
  const intent = options.intent ?? 'analyze';
  await options.manager.connectAll();
  const mcpTools = options.manager.getTools({ userId: options.userId, intent });
  const mergedTools: StructuredToolInterface[] = [
    readRequirementTool,
    checkExistingFeaturesTool,
    loadPerfBaselineTool,
    ...mcpTools,
  ];
  const llm = options.llm ?? new ChatOpenAI({
    model: 'gpt-5.6-terra',
    modelKwargs: { reasoning_effort: 'medium' },
    temperature: 0,
  });
  const agent = (options.createAgent ?? createReactAgent)({
    llm,
    tools: mergedTools,
    prompt: FUNCTIONAL_MCP_AGENT_PROMPT,
  });
  return { agent, tools: mergedTools };
}

export interface DefaultMCPServerConfigs {
  requirementAnalyzer?: MCPClientConfig;
  webSearch?: MCPClientConfig;
  ragServer?: MCPClientConfig;
}

/**
 * 注册三个章节约定的 Server。rag-server 允许由部署环境传入启动参数；未配置时
 * 保持不可用状态，MCPManager 会记录告警并让本地 fallback 接管，不连接真实 DB。
 */
export function createDefaultMCPManager(
  configs: DefaultMCPServerConfigs = {},
  options: MCPManagerOptions = {},
): MCPManager {
  const root = process.cwd().endsWith('/services/chat')
    ? process.cwd().slice(0, -'/services/chat'.length)
    : process.cwd();
  const requirementConfig = configs.requirementAnalyzer ?? {
    command: 'bun',
    args: [`${root}/services/mcp-requirement-completeness/src/index.ts`],
  };
  const webSearchConfig = configs.webSearch ?? {
    command: 'bun',
    args: [`${root}/mcp-servers/web-search/src/index.ts`],
  };
  const manager = new MCPManager({
    ...options,
    fallbackTools: options.fallbackTools ?? [readRequirementTool, checkExistingFeaturesTool, loadPerfBaselineTool],
  });
  manager
    .registerServer({
      name: 'requirement-analyzer',
      prefix: 'req_',
      client: new MCPClientService(requirementConfig),
    })
    .registerServer({
      name: 'web-search',
      prefix: 'ws_',
      client: new MCPClientService(webSearchConfig),
    });

  manager.registerServer({
    name: 'rag-server',
    client: configs.ragServer
      ? new MCPClientService(configs.ragServer)
      : createUnavailableMCPClient('rag-server is not configured', [
          {
            name: 'search_knowledge_base',
            description: '检索当前用户知识库。适用于需要引用内部文档、制度或历史资料的问题；不适用于无资料依据的闲聊。',
            inputSchema: {
              type: 'object',
              required: ['question'],
              properties: {
                question: { type: 'string', description: '需要检索的知识库问题' },
                topK: { type: 'integer', description: '返回片段数量，默认由服务决定' },
              },
            },
          },
        ]),
    allowedTools: ['search_knowledge_base'],
  });
  return manager;
}

/** 工具类型导出，便于 Controller/Service 在不依赖具体 agent 实现时注入。 */
export type MCPFunctionalTool = DynamicStructuredTool | StructuredToolInterface;
