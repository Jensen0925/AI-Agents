import { describe, expect, test } from "bun:test";
import { loadLangchainConfig } from "../src/config/load-langchain-config";
import {
  resolveModelName,
  resolveReasoningDecision,
  resolveReasoningEffort,
} from "../src/llm/model-selection";
import { normalizeChatBaseURL } from "../src/llm/normalize-base-url";

describe("模型网关地址兼容", () => {
  test("空地址保持未定义", () => {
    expect(normalizeChatBaseURL(undefined)).toBeUndefined();
    expect(normalizeChatBaseURL("")).toBeUndefined();
  });

  test("去掉末尾斜杠与误填的 /chat/completions", () => {
    expect(normalizeChatBaseURL("https://api.aijws.com/")).toBe(
      "https://api.aijws.com",
    );
    expect(
      normalizeChatBaseURL("https://api.aijws.com/chat/completions"),
    ).toBe("https://api.aijws.com");
  });

  test("保留已有的 /v1 前缀，不重复拼接", () => {
    expect(normalizeChatBaseURL("https://api.aijws.com/v1")).toBe(
      "https://api.aijws.com/v1",
    );
    expect(normalizeChatBaseURL("https://api.aijws.com/v1/")).toBe(
      "https://api.aijws.com/v1",
    );
  });
});

describe("模型分档配置驱动", () => {
  const llm = loadLangchainConfig().llm;

  test("high / medium / compressor 档位映射到集中配置", () => {
    expect(resolveModelName({ tier: "high" }, llm)).toBe(llm.modelTiers.high);
    expect(resolveModelName({ tier: "medium" }, llm)).toBe(
      llm.modelTiers.medium,
    );
    expect(resolveModelName({ tier: "compressor" }, llm)).toBe(
      llm.modelTiers.compressor,
    );
  });

  test("未传档位时使用默认模型，显式 modelName 优先", () => {
    expect(resolveModelName({}, llm)).toBe(llm.model);
    expect(resolveModelName({ modelName: "custom-model" }, llm)).toBe(
      "custom-model",
    );
  });

  test("high 档使用高强度推理，轻量档使用中等推理", () => {
    expect(resolveReasoningEffort({ tier: "high" }, llm)).toBe("high");
    expect(resolveReasoningEffort({ tier: "medium" }, llm)).toBe("medium");
    expect(resolveReasoningEffort({ tier: "compressor" }, llm)).toBe(
      "medium",
    );
  });

  test("三层推理级别映射到集中配置的模型档位", () => {
    expect(resolveModelName({ reasoningLevel: "light" }, llm)).toBe(
      llm.modelTiers.compressor,
    );
    expect(resolveModelName({ reasoningLevel: "standard" }, llm)).toBe(
      llm.modelTiers.medium,
    );
    expect(resolveModelName({ reasoningLevel: "deep" }, llm)).toBe(
      llm.modelTiers.high,
    );
    expect(resolveReasoningEffort({ reasoningLevel: "light" }, llm)).toBe(
      "medium",
    );
    expect(resolveReasoningEffort({ reasoningLevel: "deep" }, llm)).toBe(
      "high",
    );
  });
});

describe("模型环境变量配置", () => {
  test("OPENAI_MODEL 可作为所有档位的统一模型", () => {
    const script = `
      process.env.OPENAI_MODEL = "env-model";
      delete process.env.OPENAI_MODEL_HIGH;
      delete process.env.OPENAI_MODEL_MEDIUM;
      delete process.env.OPENAI_MODEL_COMPRESSOR;
      const { loadLangchainConfig } = await import("./src/config/load-langchain-config.ts");
      console.log(JSON.stringify(loadLangchainConfig().llm));
    `;
    const processResult = Bun.spawnSync(["bun", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, OPENAI_MODEL: "env-model" },
    });

    expect(processResult.exitCode).toBe(0);
    const llm = JSON.parse(processResult.stdout.toString());
    expect(llm.model).toBe("env-model");
    expect(llm.modelTiers).toEqual({
      high: "env-model",
      medium: "env-model",
      compressor: "env-model",
    });
  });
});

describe("三层推理决策", () => {
  test("闲聊和查询优先使用轻量推理", () => {
    expect(
      resolveReasoningDecision({ intent: "chat", input: "你好，今天天气不错" }),
    ).toMatchObject({ level: "light", modelTier: "compressor" });
    expect(
      resolveReasoningDecision({
        intent: "query",
        input: "查询 REQ-20240315-001 当前状态",
      }),
    ).toMatchObject({ level: "light", modelTier: "compressor" });
  });

  test("普通分析使用标准推理", () => {
    expect(
      resolveReasoningDecision({
        intent: "analyze",
        input: "开发商品列表和筛选页面",
      }),
    ).toMatchObject({ level: "standard", modelTier: "medium" });
  });

  test("高风险、复杂任务和长链路升级到深度推理", () => {
    expect(
      resolveReasoningDecision({
        intent: "analyze",
        input: "设计管理员权限和登录安全策略",
      }),
    ).toMatchObject({ level: "deep", modelTier: "high", reasoningEffort: "high" });
    expect(
      resolveReasoningDecision({
        intent: "analyze",
        input: "分析需求：开发一个用户登录功能",
      }),
    ).toMatchObject({ level: "deep", modelTier: "high" });
    expect(
      resolveReasoningDecision({
        intent: "analyze",
        isLongChain: true,
      }),
    ).toMatchObject({ level: "deep", modelTier: "high" });
  });

  test("高风险优先于查询和闲聊意图", () => {
    expect(
      resolveReasoningDecision({
        intent: "query",
        riskLevel: "high",
        input: "查询支付权限风险",
      }),
    ).toMatchObject({ level: "deep", modelTier: "high" });
  });
});
