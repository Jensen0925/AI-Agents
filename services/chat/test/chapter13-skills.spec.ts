import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
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

const CHAT_ROOT = process.cwd();
const ENV_PATH = resolve(CHAT_ROOT, '.env');
const SKILLS_DIR = resolve(CHAT_ROOT, 'src/skills/definitions');
const REQUIREMENT_SKILL_PATH = join(SKILLS_DIR, 'requirement-analysis', 'SKILL.md');
const COMPETITOR_SKILL_PATH = join(SKILLS_DIR, 'competitor-research', 'SKILL.md');
const invokedTools: string[] = [];

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

function normalizeBaseUrl(baseURL?: string): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  return normalizeChatBaseURL(baseURL);
}

function runPythonScript(scriptPath: string, payload: Record<string, unknown>): string {
  return execSync(`python3 "${scriptPath}"`, {
    cwd: CHAT_ROOT,
    encoding: 'utf8',
    input: JSON.stringify(payload),
  }).trim();
}

function createLoadSkillTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'load_skill',
    description:
      '读取指定 Skill 的完整 SKILL.md 原文。支持 requirement-analysis 与 competitor-research 两个示例 Skill，供 analyze_completeness、estimate_complexity、search_competitors、search_best_practices 等显式工具在教学演示中配合使用。',
    schema: z.object({
      skillName: z.string().min(1),
    }),
    func: async ({ skillName }) => {
      invokedTools.push(`load_skill:${skillName}`);
      const skillPath = join(SKILLS_DIR, skillName, 'SKILL.md');
      return readFileSync(skillPath, 'utf8');
    },
  });
}

function createPythonTool(options: {
  skillName: string;
  toolName: string;
  description: string;
  schema: z.ZodObject<any>;
}): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: options.toolName,
    description: options.description,
    schema: options.schema,
    func: async (input) => {
      invokedTools.push(options.toolName);
      const scriptPath = join(SKILLS_DIR, options.skillName, 'scripts', `${options.toolName}.py`);
      return runPythonScript(scriptPath, input as Record<string, unknown>);
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
          .map((item) => {
            if (item && typeof item === 'object' && 'text' in item) {
              return String((item as { text: unknown }).text);
            }
            return '';
          })
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

function createRequirementAgentTools(): DynamicStructuredTool[] {
  return [
    createLoadSkillTool(),
    createPythonTool({
      skillName: 'requirement-analysis',
      toolName: 'analyze_completeness',
      description: '分析需求文本的六维完整度。',
      schema: z.object({ requirementText: z.string().min(1) }),
    }),
    createPythonTool({
      skillName: 'requirement-analysis',
      toolName: 'estimate_complexity',
      description: '估算需求复杂度和预估工期。',
      schema: z.object({ requirementText: z.string().min(1), techStack: z.string().optional() }),
    }),
  ];
}

function createCompetitorAgentTools(): DynamicStructuredTool[] {
  return [
    createLoadSkillTool(),
    createPythonTool({
      skillName: 'competitor-research',
      toolName: 'search_competitors',
      description: '搜索竞品方案与功能布局。',
      schema: z.object({ query: z.string().min(1), domain: z.string().optional() }),
    }),
    createPythonTool({
      skillName: 'competitor-research',
      toolName: 'search_best_practices',
      description: '搜索行业最佳实践。',
      schema: z.object({ topic: z.string().min(1), industry: z.string().optional() }),
    }),
  ];
}

function createRealAgent(tools: DynamicStructuredTool[], prompt: string): ReactAgent {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.LLM_SKILLS_TEST_MODEL?.trim() || loadLangchainConfig().llm.model,
    temperature: 0,
    timeout: 60_000,
    maxRetries: 1,
    configuration: normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim())
      ? { baseURL: normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim()) }
      : undefined,
  });

  return createReactAgent({ llm: model, tools, prompt });
}

loadEnvFile(ENV_PATH);

const shouldRunLlmIntegration =
  Boolean(process.env.OPENAI_API_KEY) && process.env.RUN_LLM_SKILLS_TESTS === '1';

afterEach(() => {
  invokedTools.length = 0;
});

describe('13.4 Skills Layer 1：零 LLM 依赖测试', () => {
  test('load_skill Tool 具备固定名称与可读描述', () => {
    const tool = createLoadSkillTool();

    expect(tool.name).toBe('load_skill');
    expect(tool.description).toContain('requirement-analysis');
    expect(tool.description).toContain('competitor-research');
    expect(tool.description).toContain('analyze_completeness');
  });

  test('load_skill 能读取 requirement-analysis 的 SKILL.md 原文', async () => {
    const tool = createLoadSkillTool();
    const expected = readFileSync(REQUIREMENT_SKILL_PATH, 'utf8');

    await expect(tool.invoke({ skillName: 'requirement-analysis' })).resolves.toBe(expected);
  });

  test('analyze_completeness.py 返回完整度、覆盖维度与缺失维度', () => {
    const scriptPath = join(SKILLS_DIR, 'requirement-analysis', 'scripts', 'analyze_completeness.py');
    const result = JSON.parse(
      runPythonScript(scriptPath, {
        requirementText: '管理员需要批量导入用户数据，并提供失败提示、权限控制和异常回滚。',
      }),
    ) as {
      completenessScore: number;
      coveredDimensions: string[];
      missingDimensions: string[];
    };

    expect(typeof result.completenessScore).toBe('number');
    expect(Array.isArray(result.coveredDimensions)).toBe(true);
    expect(Array.isArray(result.missingDimensions)).toBe(true);
    expect(result.coveredDimensions.length + result.missingDimensions.length).toBeGreaterThan(0);
  });

  test('estimate_complexity.py 返回 S/M/L/XL 之一', () => {
    const scriptPath = join(SKILLS_DIR, 'requirement-analysis', 'scripts', 'estimate_complexity.py');
    const result = JSON.parse(
      runPythonScript(scriptPath, {
        requirementText: '系统需要支持 AI 生成、第三方接口对接、权限控制、批量导入和安全审计。',
      }),
    ) as {
      size: string;
      estimatedDays: number;
      complexityScore: number;
      factors: Array<{ name: string; weight: number }>;
    };

    expect(['S', 'M', 'L', 'XL']).toContain(result.size);
    expect(result.estimatedDays).toBeGreaterThan(0);
    expect(Array.isArray(result.factors)).toBe(true);
  });

  test('search_competitors.py 返回多个竞品结果', () => {
    const scriptPath = join(SKILLS_DIR, 'competitor-research', 'scripts', 'search_competitors.py');
    const result = JSON.parse(
      runPythonScript(scriptPath, {
        query: 'AI 写作助手',
        domain: '内容创作',
      }),
    ) as {
      results: Array<{ title: string; snippet: string; url: string }>;
    };

    expect(result.results.length).toBeGreaterThan(1);
    expect(result.results[0]?.title).toContain('AI 写作助手');
  });

  test('search_best_practices.py 返回最佳实践列表', () => {
    const scriptPath = join(SKILLS_DIR, 'competitor-research', 'scripts', 'search_best_practices.py');
    const result = JSON.parse(
      runPythonScript(scriptPath, {
        topic: 'AI 写作助手',
        industry: '内容创作',
      }),
    ) as {
      results: string[];
    };

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(1);
    expect(result.results.join('\n')).toContain('AI 写作助手');
  });
});

describe('13.7 Skills Layer 2：LLM 集成测试', () => {
  test.skipIf(!shouldRunLlmIntegration)('需求分析场景会调用 load_skill 和 analyze_completeness', async () => {
    const agent = createRealAgent(
      createRequirementAgentTools(),
      `你是 Skills Demo Agent。每次接到需求分析任务都必须先调用 load_skill 读取 requirement-analysis，然后至少调用 analyze_completeness。最终用中文给出简短分析。`,
    );

    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: '请先读取 requirement-analysis skill，再分析“批量导入用户数据”这个需求是否完整。',
        },
      ],
    });

    const output = extractFinalOutput(result);
    expect(invokedTools).toContain('load_skill:requirement-analysis');
    expect(invokedTools).toContain('analyze_completeness');
    expect(output.length).toBeGreaterThan(80);
    expect(output).toMatch(/完整度|需求|建议/);
  }, 90_000);

  test.skipIf(!shouldRunLlmIntegration)('竞品调研场景会调用 load_skill 和 search_competitors', async () => {
    const agent = createRealAgent(
      createCompetitorAgentTools(),
      `你是 Skills Demo Agent。每次接到竞品调研任务都必须先调用 load_skill 读取 competitor-research，然后至少调用 search_competitors。最终用中文输出结构化摘要。`,
    );

    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: '请先读取 competitor-research skill，再调研 AI 写作助手 的竞品方案。',
        },
      ],
    });

    const output = extractFinalOutput(result);
    expect(invokedTools).toContain('load_skill:competitor-research');
    expect(invokedTools).toContain('search_competitors');
    expect(output.length).toBeGreaterThan(80);
    expect(output).toMatch(/竞品|方案|实践|总结/);
  }, 90_000);
});
