import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type {
  MCPClientService,
  MCPToolCallResult,
  MCPToolDefinition,
} from './mcp-client.service';

type JSONSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  nullable?: boolean;
};

/**
 * 将 MCP tools/list 返回的 JSON Schema 转为 Zod Object。
 * 未识别的 Schema 会降级为 z.unknown()，确保新 MCP 工具不会导致整个
 * Agent 初始化失败。
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodObject {
  const normalized = schema as JSONSchema;
  const root = normalized.type === 'object' || normalized.properties
    ? normalized
    : { type: 'object', properties: {} };

  const required = new Set(root.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [name, property] of Object.entries(root.properties ?? {})) {
    const field = jsonSchemaToZodType(property);
    shape[name] = required.has(name) ? field : field.optional();
  }

  return z.object(shape);
}

/** 把 MCP content 数组压平成 LangChain Tool 所需的字符串。 */
export function serializeMCPContent(result: MCPToolCallResult): string {
  const content = result.content ?? [];
  const serialized = content.map((item) => {
    if (item.type === 'text') return item.text;
    if (item.type === 'image') return `[image: ${item.mimeType}]`;
    return `[${item.type}]`;
  });

  if (serialized.length > 0) return serialized.join('\n');
  if (result.structuredContent) return JSON.stringify(result.structuredContent);
  return '';
}

/**
 * 将已连接 MCP Server 的全部工具转换为 LangChain DynamicStructuredTool。
 * prefix 可用于多个 MCP Server 共存时避免工具名冲突，例如 `requirements_`。
 */
export function bridgeMCPToLangChain(
  client: MCPClientService,
  prefix = '',
): DynamicStructuredTool[] {
  if (!client.isConnected()) {
    throw new Error('MCP client is not connected. Call connect() before bridging tools.');
  }

  return client.getTools().map((mcpTool) => createLangChainTool(client, mcpTool, prefix));
}

function createLangChainTool(
  client: MCPClientService,
  mcpTool: MCPToolDefinition,
  prefix: string,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: `${prefix}${mcpTool.name}`,
    description: mcpTool.description ?? mcpTool.title ?? `MCP tool: ${mcpTool.name}`,
    schema: jsonSchemaToZod(mcpTool.inputSchema),
    func: async (input) => {
      const result = await client.callTool(mcpTool.name, input as Record<string, unknown>);
      return serializeMCPContent(result);
    },
  });
}

function jsonSchemaToZodType(schema: JSONSchema): z.ZodType {
  const normalized = schema.anyOf?.[0] ?? schema.oneOf?.[0] ?? schema;
  let result: z.ZodType;

  if (normalized.enum?.length) {
    result = z.enum(normalized.enum.map(String) as [string, ...string[]]);
  } else {
    const type = Array.isArray(normalized.type)
      ? normalized.type.find((candidate) => candidate !== 'null')
      : normalized.type;

    switch (type) {
      case 'string':
        result = z.string();
        break;
      case 'number':
      case 'integer':
        result = z.number();
        break;
      case 'boolean':
        result = z.boolean();
        break;
      case 'array':
        result = z.array(normalized.items ? jsonSchemaToZodType(normalized.items) : z.unknown());
        break;
      case 'object': {
        const required = new Set(normalized.required ?? []);
        const shape: Record<string, z.ZodType> = {};
        for (const [name, property] of Object.entries(normalized.properties ?? {})) {
          const field = jsonSchemaToZodType(property);
          shape[name] = required.has(name) ? field : field.optional();
        }
        result = z.object(shape);
        break;
      }
      default:
        result = z.unknown();
    }
  }

  if (normalized.description) result = result.describe(normalized.description);
  return normalized.nullable || (Array.isArray(normalized.type) && normalized.type.includes('null'))
    ? result.nullable()
    : result;
}
