import { describe, expect, test } from "bun:test";
import { loadLangchainConfig } from "../src/config/load-langchain-config";
import {
  resolveModelName,
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

  test("high / medium / compressor 档位映射到 YAML 配置", () => {
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
});
