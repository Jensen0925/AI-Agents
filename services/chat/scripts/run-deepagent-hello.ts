import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { z } from 'zod';

const ROOT_DIR = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT_DIR, '.env');
const DEFAULT_MODEL = 'gpt-5.6-terra';

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先配置 services/chat/.env。`);
  }
  return value;
}

function normalizeBaseUrl(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  const normalized = baseURL.replace(/\/+$/, '');
  return /\/v\d+$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function getFinalReply(result: Record<string, unknown>): string {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') {
      continue;
    }

    const text = textFromContent((message as { content?: unknown }).content);
    if (text.trim()) {
      return text;
    }
  }

  return '(Agent 未返回文本回复)';
}

function printStateValue(label: string, value: unknown): void {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(value ?? [], null, 2));
}

async function run(): Promise<void> {
  loadEnvFile(ENV_PATH);

  const apiKey = requireEnv('OPENAI_API_KEY');
  const baseURL = normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim());
  const modelName = process.env.DEEPAGENT_MODEL?.trim() || DEFAULT_MODEL;

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    maxRetries: 1,
    timeout: 60_000,
    configuration: baseURL ? { baseURL } : undefined,
  });

  const getWeather = new DynamicStructuredTool({
    name: 'get_weather',
    description: '查询指定城市的当前天气。在用户询问天气时调用。',
    schema: z.object({
      city: z.string().min(1).describe('要查询天气的城市名称'),
    }),
    func: async ({ city }) => `${city}今天天气晴，18-26°C，微风。`,
  });

  const agent = createDeepAgent({
    model,
    tools: [getWeather],
    systemPrompt: '你是一个天气助手',
  });

  console.log('[DeepAgent Hello] model:', modelName);
  console.log('[DeepAgent Hello] baseURL:', baseURL ?? '(default)');

  const result = (await agent.invoke({
    messages: [{ role: 'user', content: '北京今天天气怎么样？' }],
  })) as Record<string, unknown>;

  console.log('\n[Final Reply]');
  console.log(getFinalReply(result));
  printStateValue('Todos', result.todos);
  printStateValue('Files', result.files);
}

run().catch((error) => {
  console.error('\n[DeepAgent Hello] 运行失败');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
