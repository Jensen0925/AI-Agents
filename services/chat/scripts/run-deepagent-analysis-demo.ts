import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { z } from 'zod';

const ROOT_DIR = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT_DIR, '.env');
const REQUIREMENT_ANALYSIS_SCRIPTS_DIR = resolve(
  ROOT_DIR,
  'src/skills/definitions/requirement-analysis/scripts',
);
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

function callPythonTool(
  scriptName: 'analyze_completeness' | 'estimate_complexity',
  payload: Record<string, unknown>,
): string {
  const scriptPath = join(REQUIREMENT_ANALYSIS_SCRIPTS_DIR, `${scriptName}.py`);
  if (!existsSync(scriptPath)) {
    throw new Error(`未找到 Python 工具脚本：${scriptPath}`);
  }

  const input = JSON.stringify(payload);
  console.log(`\n[Python Tool] ${scriptName}`);
  console.log(`[Python Tool] input: ${input}`);

  // scriptPath 来自固定的本地目录，不包含用户输入；payload 通过 stdin 传递，避免拼接到 shell 命令中。
  const output = execSync(`python3 ${JSON.stringify(scriptPath)}`, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }).trim();

  console.log(`[Python Tool] output length: ${output.length}`);
  return output;
}

function extractFinalOutput(result: Record<string, unknown>): string {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') {
      continue;
    }

    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => (
          part && typeof part === 'object' && 'text' in part
            ? String((part as { text: unknown }).text)
            : ''
        ))
        .filter(Boolean)
        .join('\n');
      if (text.trim()) {
        return text;
      }
    }
  }

  return '(Agent 未返回文本回复)';
}

async function run(): Promise<void> {
  loadEnvFile(ENV_PATH);

  const apiKey = requireEnv('OPENAI_API_KEY');
  const baseURL = normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim());
  const modelName = process.env.DEEPAGENT_MODEL?.trim() || DEFAULT_MODEL;
  const toolCalls: string[] = [];

  const analyzeCompleteness = new DynamicStructuredTool({
    name: 'analyze_completeness',
    description: '分析需求文本在用户角色、功能、验收、优先级、非功能和边界条件六个维度的完整度。',
    schema: z.object({
      requirementText: z.string().min(1).describe('需要评估的需求文本'),
    }),
    func: async (input) => {
      toolCalls.push(`analyze_completeness(${input.requirementText})`);
      return callPythonTool('analyze_completeness', input);
    },
  });

  const estimateComplexity = new DynamicStructuredTool({
    name: 'estimate_complexity',
    description: '估算需求的实现规模、预估人天、复杂度分数和复杂因素。',
    schema: z.object({
      requirementText: z.string().min(1).describe('需要评估的需求文本'),
      techStack: z.string().optional().describe('可选的技术栈信息'),
    }),
    func: async (input) => {
      toolCalls.push(`estimate_complexity(${input.requirementText})`);
      return callPythonTool('estimate_complexity', input);
    },
  });

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    maxRetries: 1,
    timeout: 60_000,
    configuration: baseURL ? { baseURL } : undefined,
  });

  const agent = createDeepAgent({
    model,
    tools: [analyzeCompleteness, estimateComplexity],
    systemPrompt: `你是一个需求分析专家。针对每个需求分析请求，必须先调用 analyze_completeness 和 estimate_complexity，
再基于两个工具的 JSON 结果给出中文分析报告。报告至少应包含需求完整度、复杂度评估和下一步建议。`,
  });

  console.log('[DeepAgent Analysis Demo] model:', modelName);
  console.log('[DeepAgent Analysis Demo] baseURL:', baseURL ?? '(default)');

  const result = (await agent.invoke({
    messages: [{ role: 'user', content: '分析批量导入用户数据需求' }],
  })) as Record<string, unknown>;
  const finalOutput = extractFinalOutput(result);

  console.log('\n[Agent Final Output]');
  console.log(finalOutput);
  console.log('\n[Tool Call Chain]');
  console.log(toolCalls.length > 0 ? toolCalls.map((call) => `- ${call}`).join('\n') : '(no tools called)');
  console.log(`\n[Output Length] ${finalOutput.length}`);
}

run().catch((error) => {
  console.error('\n[DeepAgent Analysis Demo] 运行失败');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
