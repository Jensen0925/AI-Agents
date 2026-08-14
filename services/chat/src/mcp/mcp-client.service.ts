import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** stdio MCP Server 的启动参数。 */
export interface MCPClientConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 单个 MCP 请求的超时（毫秒），默认 30 秒。 */
  timeout?: number;
}

/** MCP tools/list 响应中供桥接器使用的最小工具定义。 */
export interface MCPToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tools/call 响应中供调用方使用的最小内容结构。 */
export interface MCPToolCallResult {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data?: string }
    | { type: string; [key: string]: unknown }
  >;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 管理一个 stdio MCP Server 连接。
 *
 * 该服务刻意只处理 MCP 协议、连接生命周期和工具缓存；把 MCP Tool 转成
 * LangChain Tool 的职责由 mcp-to-langchain.ts 承担。
 */
@Injectable()
export class MCPClientService {
  private client?: Client;
  private transport?: StdioClientTransport;
  private tools: MCPToolDefinition[] = [];
  private connectionPromise?: Promise<void>;
  private connected = false;

  constructor(private readonly config: MCPClientConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = this.openConnection();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = undefined;
    }
  }

  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult> {
    if (!this.client || !this.connected) {
      throw new Error('MCP client is not connected. Call connect() before callTool().');
    }

    return (await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.timeout },
    )) as MCPToolCallResult;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    this.tools = [];
    this.connected = false;
    this.connectionPromise = undefined;

    if (client) await client.close();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private get timeout(): number {
    return this.config.timeout ?? 30_000;
  }

  private async openConnection(): Promise<void> {
    const client = new Client({
      name: 'cloudsage-chat',
      version: '0.1.0',
    });
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
      stderr: 'pipe',
    });

    transport.onclose = () => {
      this.connected = false;
      this.tools = [];
    };

    try {
      await client.connect(transport, { timeout: this.timeout });
      this.client = client;
      this.transport = transport;
      this.tools = await this.listAllTools(client);
      this.connected = true;
    } catch (error) {
      await client.close().catch(() => undefined);
      this.client = undefined;
      this.transport = undefined;
      this.tools = [];
      this.connected = false;
      throw error;
    }
  }

  private async listAllTools(client: Client): Promise<MCPToolDefinition[]> {
    const tools: MCPToolDefinition[] = [];
    let cursor: string | undefined;

    do {
      const page = await client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: this.timeout },
      );
      tools.push(...(page.tools as MCPToolDefinition[]));
      cursor = page.nextCursor;
    } while (cursor);

    return tools;
  }
}
