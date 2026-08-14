import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  MCPClientService,
  MCPToolCallResult,
  MCPToolDefinition,
} from './mcp-client.service';
import { jsonSchemaToZod, serializeMCPContent } from './mcp-to-langchain';

/** Agent 当前处理的任务意图；未知意图默认不暴露外部工具。 */
export type MCPToolIntent = 'analyze' | 'query' | 'chat' | string;

/** 只保留 MCPManager 实际需要的客户端能力，便于内存测试和替换传输层。 */
export interface MCPToolClient {
  connect?: () => Promise<void>;
  close?: () => Promise<void>;
  isConnected: () => boolean;
  getTools: () => MCPToolDefinition[];
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<MCPToolCallResult>;
}

export interface MCPServerRegistration {
  name: string;
  /** 多 Server 共存时用于避免工具名冲突，例如 req_、ws_。 */
  prefix?: string;
  client: MCPToolClient;
  /** rag-server 等服务可限制只暴露指定工具。 */
  allowedTools?: string[];
}

export interface AgentMCPTrace {
  id: string;
  userId: string;
  toolName: string;
  serverName?: string;
  intent?: string;
  status: 'started' | 'completed' | 'failed' | 'fallback' | 'denied';
  startedAt: string;
  finishedAt?: string;
  latencyMs?: number;
  args?: Record<string, unknown>;
  error?: string;
}

export type CanUseTool = (userId: string, toolName: string) => boolean;

export interface MCPManagerOptions {
  fallbackTools?: StructuredToolInterface[];
  canUseTool?: CanUseTool;
  logger?: Pick<Console, 'warn'>;
}

type RegisteredTool = {
  registration: MCPServerRegistration;
  definition: MCPToolDefinition;
  exposedName: string;
};

/**
 * MCP 多 Server 连接、工具收敛和审计边界。
 *
 * Manager 不把“工具存在”误当成“用户可调用”：每个 LangChain Tool 的 func
 * 在真正发出 MCP tools/call 前都会执行权限检查，并记录可查询的 trace。
 */
export class MCPManager {
  private readonly registrations: MCPServerRegistration[] = [];
  private readonly traces: AgentMCPTrace[] = [];
  private readonly unavailableServers = new Map<string, string>();
  private readonly fallbackTools: StructuredToolInterface[];
  private readonly canUseTool: CanUseTool;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(options: MCPManagerOptions = {}) {
    this.fallbackTools = options.fallbackTools ?? [];
    this.canUseTool = options.canUseTool ?? defaultCanUseTool;
    this.logger = options.logger ?? console;
  }

  registerServer(registration: MCPServerRegistration): this {
    if (this.registrations.some((item) => item.name === registration.name)) {
      throw new Error(`MCP server already registered: ${registration.name}`);
    }
    this.registrations.push({ ...registration, prefix: registration.prefix ?? '' });
    return this;
  }

  /** 尽力连接全部 Server；单个外部服务不可用不能阻塞本地 Agent 与 fallback。 */
  async connectAll(): Promise<void> {
    await Promise.all(
      this.registrations.map(async (registration) => {
        try {
          await registration.client.connect?.();
          if (!registration.client.isConnected()) {
            throw new Error('server did not enter connected state');
          }
          this.unavailableServers.delete(registration.name);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.unavailableServers.set(registration.name, reason);
          this.logger.warn(`[MCPManager] ${registration.name} unavailable: ${reason}`);
        }
      }),
    );
  }

  /**
   * 获取经意图裁剪和用户权限过滤后的 LangChain 工具。
   * chat 意图默认返回空数组，避免闲聊把所有 MCP 描述带入上下文。
   */
  getTools(options: { intent?: MCPToolIntent; userId?: string } = {}): DynamicStructuredTool[] {
    const intent = options.intent ?? 'analyze';
    const userId = options.userId ?? 'system';
    if (intent === 'chat') return [];

    return this.listRegisteredTools()
      .filter((tool) => isToolRelevantForIntent(tool.exposedName, intent))
      .filter((tool) => this.canUseTool(userId, tool.exposedName))
      .map((tool) => this.toLangChainTool(tool, userId, intent));
  }

  /** 供 API 或测试直接使用；与 LangChain Tool 共享权限、追踪与降级路径。 */
  async callTool(
    userId: string,
    toolName: string,
    args: Record<string, unknown>,
    intent: MCPToolIntent = 'analyze',
  ): Promise<string> {
    const tool = this.listRegisteredTools().find((item) => item.exposedName === toolName);
    if (!tool) return this.tryFallback(userId, toolName, args, intent, 'tool_not_found');
    if (!this.canUseTool(userId, toolName)) {
      this.recordTrace({ userId, toolName, serverName: tool.registration.name, intent, status: 'denied', args, error: 'permission_denied' });
      return this.tryFallback(userId, toolName, args, intent, 'permission_denied');
    }

    const started = Date.now();
    const trace = this.recordTrace({
      userId,
      toolName,
      serverName: tool.registration.name,
      intent,
      status: 'started',
      args,
    });

    try {
      if (!tool.registration.client.isConnected()) {
        throw new Error(this.unavailableServers.get(tool.registration.name) ?? 'server_not_connected');
      }
      const result = await tool.registration.client.callTool(tool.definition.name, args);
      if (result.isError) throw new Error(serializeMCPContent(result) || 'mcp_tool_error');
      this.finishTrace(trace, 'completed', started);
      return serializeMCPContent(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.finishTrace(trace, 'failed', started, reason);
      return this.tryFallback(userId, toolName, args, intent, reason);
    }
  }

  getTraces(): AgentMCPTrace[] {
    return this.traces.map((trace) => ({ ...trace, args: trace.args ? { ...trace.args } : undefined }));
  }

  getUnavailableServers(): ReadonlyMap<string, string> {
    return new Map(this.unavailableServers);
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.registrations.map((registration) => registration.client.close?.()));
  }

  private listRegisteredTools(): RegisteredTool[] {
    return this.registrations.flatMap((registration) => {
      return registration.client
        .getTools()
        .filter((definition) => !registration.allowedTools || registration.allowedTools.includes(definition.name))
        .map((definition) => ({
          registration,
          definition,
          exposedName: `${registration.prefix ?? ''}${definition.name}`,
        }));
    });
  }

  private toLangChainTool(
    tool: RegisteredTool,
    userId: string,
    intent: MCPToolIntent,
  ): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: tool.exposedName,
      description: tool.definition.description ?? tool.definition.title ?? `MCP tool: ${tool.exposedName}`,
      schema: jsonSchemaToZod(tool.definition.inputSchema),
      func: (input) => this.callTool(userId, tool.exposedName, input as Record<string, unknown>, intent),
    });
  }

  private async tryFallback(
    userId: string,
    toolName: string,
    args: Record<string, unknown>,
    intent: MCPToolIntent,
    sourceError: string,
  ): Promise<string> {
    const fallback = findFallbackTool(this.fallbackTools, toolName);
    if (!fallback) {
      return JSON.stringify({ error: sourceError, toolName, fallback: false });
    }

    const started = Date.now();
    const trace = this.recordTrace({ userId, toolName, intent, status: 'fallback', args, error: sourceError });
    try {
      const result = await fallback.invoke(args);
      this.finishTrace(trace, 'fallback', started);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.finishTrace(trace, 'failed', started, reason);
      return JSON.stringify({ error: sourceError, fallbackError: reason, toolName });
    }
  }

  private recordTrace(input: Omit<AgentMCPTrace, 'id' | 'startedAt'>): AgentMCPTrace {
    const trace: AgentMCPTrace = {
      ...input,
      id: `mcp_${Date.now()}_${this.traces.length + 1}`,
      startedAt: new Date().toISOString(),
    };
    this.traces.push(trace);
    return trace;
  }

  private finishTrace(
    trace: AgentMCPTrace,
    status: Extract<AgentMCPTrace['status'], 'completed' | 'failed' | 'fallback'>,
    started: number,
    error?: string,
  ): void {
    trace.status = status;
    trace.finishedAt = new Date().toISOString();
    trace.latencyMs = Date.now() - started;
    if (error) trace.error = error;
  }
}

/** 默认最小权限：只允许本章声明的只读分析/检索工具；未知和写操作一律拒绝。 */
export const defaultCanUseTool: CanUseTool = (_userId, toolName) =>
  /^(req_(analyze_completeness|estimate_complexity|check_conflicts|generate_user_stories)|ws_(search_competitors|search_best_practices|search_tech_stack)|search_knowledge_base)$/.test(
    toolName,
  );

function isToolRelevantForIntent(toolName: string, intent: MCPToolIntent): boolean {
  if (intent === 'analyze') {
    return /^(req_|ws_(search_best_practices|search_tech_stack)|search_knowledge_base)/.test(toolName);
  }
  if (intent === 'query') {
    return /^(req_|search_knowledge_base)/.test(toolName);
  }
  return false;
}

function findFallbackTool(
  fallbackTools: StructuredToolInterface[],
  toolName: string,
): StructuredToolInterface | undefined {
  const unprefixed = toolName.replace(/^(req_|ws_)/, '');
  return fallbackTools.find((tool) => tool.name === toolName || tool.name === unprefixed);
}

/** 未配置 rag-server 时使用的占位客户端：保留注册信息但不会伪造远端连接成功。 */
export function createUnavailableMCPClient(
  reason: string,
  tools: MCPToolDefinition[] = [],
): MCPToolClient {
  return {
    isConnected: () => false,
    getTools: () => [...tools],
    callTool: async () => {
      throw new Error(reason);
    },
  };
}

/** 便捷校验，供调用方构造 MCP 工具输入时复用。 */
export const mcpToolArgumentsSchema = z.record(z.string(), z.unknown());

/** 确保真实 MCPClientService 可直接赋给 MCPToolClient（编译期契约检查）。 */
const _mcpClientContract: MCPToolClient | undefined = undefined as
  | MCPClientService
  | undefined;
void _mcpClientContract;
