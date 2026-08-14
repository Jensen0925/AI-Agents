import { describe, expect, it } from "bun:test";
import {
  tokenize,
  bm25Search,
  hybridSearch,
  embeddingRerank,
  type RetrievalResult,
} from "../src/document/hybrid-retrieval";
import {
  buildRetrievedContextBlock,
} from "../src/llm/graph/requirement-analysis-graph";
import { getExpertTools } from "../src/llm/graph/experts";
import { detectLongChain } from "../src/llm/agents/orchestrator.service";

const doc = (chunkId: string, content: string): RetrievalResult => ({
  chunkId,
  documentId: `doc-${chunkId}`,
  content,
  chunkIndex: 0,
  score: 0,
});

describe("20.6 长链路由 detectLongChain", () => {
  it("两个不同需求编号进入长链，单编号和重复编号留在主图", () => {
    expect(detectLongChain("评估 REQ-001 与 REQ-002 的冲突")).toBe(true);
    expect(detectLongChain("REQ-001 又是 REQ-001")).toBe(false);
    expect(detectLongChain("新增一个登录功能")).toBe(false);
  });
});

describe("20.3 检索上下文注入 buildRetrievedContextBlock", () => {
  it("空值和占位文本不污染 prompt", () => {
    expect(buildRetrievedContextBlock()).toBe("");
    expect(buildRetrievedContextBlock("无相关参考文档")).toBe("");
  });

  it("有效资料包含参考资料标题和原文", () => {
    const block = buildRetrievedContextBlock("登录必须使用 OAuth2 授权码模式");
    expect(block).toContain("参考资料");
    expect(block).toContain("OAuth2");
  });
});

describe("20.4 MCP 降级与专家本地工具", () => {
  it("连接不可用时仍返回领域本地工具", () => {
    const functionalTools = getExpertTools("functional").map((tool) => tool.name);
    expect(functionalTools).toEqual([
      "search_requirement",
      "check_conflicts",
    ]);
    expect(getExpertTools("security").map((tool) => tool.name)).toContain(
      "assess_security",
    );
    expect(getExpertTools("unknown-domain")).toEqual([]);
  });
});

describe("20.2 hybrid 检索后端", () => {
  it("中英文分词可用于 BM25", () => {
    expect(tokenize("OAuth2 企业微信")).toEqual(["oauth2", "企", "业", "微", "信"]);
  });

  it("BM25 将命中查询词的文档排在前面", () => {
    const ranked = bm25Search("企业微信 OAuth2", [
      doc("a", "企业微信登录需要 OAuth2 授权码模式"),
      doc("b", "今天天气不错"),
      doc("c", "微信支付账单"),
    ]);
    expect(ranked[0]?.chunkId).toBe("a");
    expect(ranked.find((item) => item.chunkId === "b")).toBeUndefined();
  });

  it("RRF 融合两路结果并去重", async () => {
    const result = await hybridSearch(
      "q",
      async () => [doc("a", "a"), doc("b", "b")],
      async () => [doc("b", "b"), doc("c", "c")],
      3,
    );
    expect(result.map((item) => item.chunkId)).toEqual(["b", "a", "c"]);
  });

  it("embeddingRerank 按余弦相似度精排", async () => {
    const result = await embeddingRerank(
      "q",
      [doc("a", "a"), doc("b", "b")],
      async () => [[1, 0], [0, 1], [1, 0]],
      2,
    );
    expect(result[0]?.chunkId).toBe("b");
  });
});
