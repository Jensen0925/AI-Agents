import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { loadLangchainConfig } from '../src/config/load-langchain-config';
import { normalizeChatBaseURL } from '../src/llm/normalize-base-url';

type ReactAgent = {
  invoke(input: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
};

type CreateReactAgent = (input: {
  llm: unknown;
  tools: DynamicStructuredTool[];
  prompt: string;
}) => ReactAgent;

const { createReactAgent } = require('@langchain/langgraph/prebuilt') as {
  createReactAgent: CreateReactAgent;
};

const ROOT_DIR = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT_DIR, '.env');
const SKILLS_DIR = resolve(ROOT_DIR, 'src/skills/definitions');

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
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
    throw new Error(
      `缺少环境变量 ${name}。请先配置 services/chat/.env，并优先完成 Layer 1 测试后再运行 Skills Demo。`,
    );
  }
  return value;
}

function normalizeBaseUrl(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }
  return normalizeChatBaseURL(baseURL);
}

function summarizeInput(payload: unknown): string {
  const text = JSON.stringify(payload, null, 0);
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

async function callPythonTool(
  skillName: string,
  scriptName: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const scriptPath = join(SKILLS_DIR, skillName, 'scripts', `${scriptName}.py`);
  if (!existsSync(scriptPath)) {
    throw new Error(`未找到 Python 工具脚本：${scriptPath}`);
  }

  console.log(`\n[Python Tool] ${scriptName}`);
  console.log(`[Python Tool] input: ${summarizeInput(payload)}`);

  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn('python3', [scriptPath], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python 工具执行失败 (${scriptName})：${stderr || `exit ${code}`}`));
        return;
      }
      resolveOutput(stdout.trim());
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

  console.log(`[Python Tool] output length: ${output.length}`);
  return output;
}

function createLoadSkillTool(toolCalls: string[]): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'load_skill',
    description: '读取指定 Skill 的完整 SKILL.md 原文。每次开始任务前都应先调用，用于理解该 Skill 的工作方式和工具使用约束。',
    schema: z.object({
      skillName: z.string().min(1).describe('要读取的 Skill 名称，例如 requirement-analysis 或 competitor-research'),
    }),
    func: async ({ skillName }) => {
      const skillPath = join(SKILLS_DIR, skillName, 'SKILL.md');
      if (!existsSync(skillPath)) {
        throw new Error(`未找到 Skill 文件：${skillPath}`);
      }

      const content = readFileSync(skillPath, 'utf8');
      toolCalls.push(`load_skill(${skillName})`);
      console.log(`\n[Skill] load_skill`);
      console.log(`[Skill] name: ${skillName}`);
      console.log(`[Skill] path: ${skillPath}`);
      console.log(`[Skill] content length: ${content.length}`);
      return content;
    },
  });
}

function createPythonTool(options: {
  skillName: string;
  toolName: string;
  description: string;
  schema: z.ZodObject<any>;
  toolCalls: string[];
}): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: options.toolName,
    description: options.description,
    schema: options.schema,
    func: async (input) => {
      options.toolCalls.push(`${options.toolName}(${summarizeInput(input)})`);
      return callPythonTool(options.skillName, options.toolName, input as Record<string, unknown>);
    },
  });
}

function extractFinalOutput(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (typeof record.output === 'string') {
      return record.output;
    }

    const messages = Array.isArray(record.messages) ? record.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index] as { content?: unknown } | undefined;
      if (!candidate) {
        continue;
      }

      if (typeof candidate.content === 'string' && candidate.content.trim()) {
        return candidate.content;
      }

      if (Array.isArray(candidate.content)) {
        const text = candidate.content
          .map((item) => (item && typeof item === 'object' && 'text' in item ? String((item as { text: unknown }).text) : ''))
          .join('\n')
          .trim();
        if (text) {
          return text;
        }
      }
    }
  }

  return JSON.stringify(result, null, 2);
}

async function run(): Promise<void> {
  loadEnvFile(ENV_PATH);

  const apiKey = requireEnv('OPENAI_API_KEY');
  const baseURL = normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim());
  const modelName = process.env.SKILL_DEMO_MODEL?.trim() || loadLangchainConfig().llm.model;

  console.log('[Skills Demo] root:', ROOT_DIR);
  console.log('[Skills Demo] skills dir:', SKILLS_DIR);
  console.log('[Skills Demo] model:', modelName);
  console.log('[Skills Demo] baseURL:', baseURL ?? '(default)');

  const toolCalls: string[] = [];
  const tools: DynamicStructuredTool[] = [
    createLoadSkillTool(toolCalls),
    createPythonTool({
      skillName: 'requirement-analysis',
      toolName: 'analyze_completeness',
      description: '分析需求文本的六维完整度，适用于功能需求是否描述充分的判断。',
      schema: z.object({ requirementText: z.string().min(1) }),
      toolCalls,
    }),
    createPythonTool({
      skillName: 'requirement-analysis',
      toolName: 'estimate_complexity',
      description: '估算需求复杂度和预估人天，适用于评估实现成本与主要复杂因子。',
      schema: z.object({
        requirementText: z.string().min(1),
        techStack: z.string().optional(),
      }),
      toolCalls,
    }),
    createPythonTool({
      skillName: 'competitor-research',
      toolName: 'search_competitors',
      description: '搜索竞品方案，适用于调研某类产品或能力的竞品功能布局。',
      schema: z.object({
        query: z.string().min(1),
        domain: z.string().optional(),
      }),
      toolCalls,
    }),
    createPythonTool({
      skillName: 'competitor-research',
      toolName: 'search_best_practices',
      description: '搜索最佳实践，适用于总结某个主题在行业中的常见设计模式。',
      schema: z.object({
        topic: z.string().min(1),
        industry: z.string().optional(),
      }),
      toolCalls,
    }),
  ];

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
    maxRetries: 1,
    timeout: 60_000,
    configuration: baseURL ? { baseURL } : undefined,
  });

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt: `你是一个 Skills Demo Agent。这是教学级 PoC，不是生产平台。

工作规则：
1. 每次接到任务，必须先调用 load_skill，读取最相关的 Skill。
2. 读取 Skill 后，再按 Skill 指引调用最少必要的工具。
3. 需求分析类问题使用 requirement-analysis Skill。
4. 竞品调研类问题使用 competitor-research Skill。
5. 工具返回值是字符串；其中很多字符串本身是 JSON，请基于其内容进行总结。
6. 最终输出必须使用中文，结构清晰，适合教学演示。
7. 除非确有必要，不要调用无关工具。`,
  });

  const queries = [
    '请分析“批量导入用户数据”的需求，给出完整度、复杂度和建议。',
    '请调研“AI 写作助手”的竞品方案，并总结值得借鉴的最佳实践。',
  ];

  for (const query of queries) {
    toolCalls.length = 0;
    console.log('\n==================================================');
    console.log('[User Input]');
    console.log(query);

    const result = await agent.invoke({
      messages: [{ role: 'user', content: query }],
    });

    const finalOutput = extractFinalOutput(result);
    console.log('\n[Tool Call Chain]');
    if (toolCalls.length === 0) {
      console.log('(no tools called)');
    } else {
      for (const call of toolCalls) {
        console.log(`- ${call}`);
      }
    }

    console.log('\n[Agent Final Output]');
    console.log(finalOutput);
    console.log(`\n[Output Length] ${finalOutput.length}`);
  }
}

run().catch((error) => {
  console.error('\n[Skills Demo] 运行失败');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
