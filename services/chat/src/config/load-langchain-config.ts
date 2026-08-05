import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

// YAML 的类型只描述可安全落盘的运行参数，不包含密钥或服务地址。
export interface LangchainConfig {
  llm: {
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    maxRetries: number;
    batchSize: number;
    maxConcurrency: number;
  };
  retrieval: {
    enabled: boolean;
    topK: number;
    minScore: number;
  };
  tools: {
    enabled: boolean;
    allowList: string[];
  };
  features: {
    streaming: boolean;
    batch: boolean;
  };
}

// 所有外部服务凭据集中在一个对象中，后续 embedding/retrieval 可直接复用。
export interface ApiKeys {
  openai: {
    apiKey: string;
    baseURL?: string;
  };
  embedding: {
    apiKey?: string;
  };
  vectorDb: {
    url?: string;
    apiKey?: string;
  };
}

// 配置文件在进程生命周期内只读取一次，避免每次模型调用都访问磁盘。
let cachedConfig: LangchainConfig | undefined;

// js-yaml 返回 unknown，先逐层确认映射结构，再读取具体字段。
function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`LangChain config value "${path}" must be an object`);
  }
}

// 以下读取函数同时完成类型收窄，并在配置错误时给出明确字段名。
function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`LangChain config value "${key}" must be a non-empty string`);
  }

  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`LangChain config value "${key}" must be a finite number`);
  }

  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];

  if (typeof value !== "boolean") {
    throw new Error(`LangChain config value "${key}" must be a boolean`);
  }

  return value;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`LangChain config value "${key}" must be a string array`);
  }

  return value;
}

function optionalEnv(name: string): string | undefined {
  // 空字符串按“未配置”处理，兼容仓库中的空值 .env 模板。
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * 读取并校验 config/langchain.yaml。
 *
 * 返回值会被缓存；运行期间修改 YAML 后需要重启 Chat 服务才能生效。
 */
export function loadLangchainConfig(): LangchainConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // 开发环境可能从 services/chat、仓库根目录或 Docker 工作目录启动。
  // 不能只依赖 process.cwd() 的单一路径，否则 `bun run dev` 从根目录
  // 启动时会误报找不到配置，随后模型工厂和整个聊天请求都会降级/失败。
  const configCandidates = [
    resolve(process.cwd(), "config/langchain.yaml"),
    resolve(process.cwd(), "services/chat/config/langchain.yaml"),
    resolve(process.cwd(), "../config/langchain.yaml"),
  ];
  const configPath = configCandidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    throw new Error(
      `LangChain config file not found. Tried: ${configCandidates.join(", ")}`,
    );
  }

  const parsed: unknown = load(readFileSync(configPath, "utf8"));
  assertRecord(parsed, "root");

  // 四个顶层分区必须同时存在，防止缺省配置悄悄改变运行行为。
  const { llm, retrieval, tools, features } = parsed;
  assertRecord(llm, "llm");
  assertRecord(retrieval, "retrieval");
  assertRecord(tools, "tools");
  assertRecord(features, "features");

  cachedConfig = {
    llm: {
      model: readString(llm, "model"),
      temperature: readNumber(llm, "temperature"),
      maxTokens: readNumber(llm, "maxTokens"),
      timeoutMs: readNumber(llm, "timeoutMs"),
      maxRetries: readNumber(llm, "maxRetries"),
      batchSize: readNumber(llm, "batchSize"),
      maxConcurrency: readNumber(llm, "maxConcurrency"),
    },
    retrieval: {
      enabled: readBoolean(retrieval, "enabled"),
      topK: readNumber(retrieval, "topK"),
      minScore: readNumber(retrieval, "minScore"),
    },
    tools: {
      enabled: readBoolean(tools, "enabled"),
      allowList: readStringArray(tools, "allowList"),
    },
    features: {
      streaming: readBoolean(features, "streaming"),
      batch: readBoolean(features, "batch"),
    },
  };

  return cachedConfig;
}

/**
 * 从 process.env 获取模型、Embedding 与向量库连接信息。
 *
 * OPENAI_API_KEY 是创建聊天模型的必填项；其余字段为后续能力预留。
 */
export function getApiKeys(): ApiKeys {
  // YAML 只承载运行参数；密钥和服务地址始终留在进程环境中。
  return {
    openai: {
      apiKey: requiredEnv("OPENAI_API_KEY"),
      baseURL: optionalEnv("OPENAI_BASE_URL"),
    },
    embedding: {
      apiKey: optionalEnv("EMBEDDING_API_KEY"),
    },
    vectorDb: {
      url: optionalEnv("VECTOR_DB_URL"),
      apiKey: optionalEnv("VECTOR_DB_API_KEY"),
    },
  };
}
