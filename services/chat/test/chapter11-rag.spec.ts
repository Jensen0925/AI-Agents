import { describe, expect, it } from "bun:test";
import {
  cosineSimilarity,
  dot,
  euclideanDistance,
  l2Norm,
  normalize,
} from "../rag/embedding/similarity";
import { chunkText } from "../rag/chunking/document-chunker";
import { chunkParentChild } from "../rag/chunking/parent-child-chunker";
import { similaritySearch } from "../rag/retrieval/vector-store";
import {
  mrr,
  ndcgAtK,
  recallAtK,
} from "../rag/evaluation/retrieval-metrics";
import { runRagasEvaluation } from "../rag/evaluation/ragas-runner";
import {
  createRagTool,
  RAG_TOOL_DESCRIPTION,
} from "../rag/agent/rag-tool";

describe("11.2.4 相似度", () => {
  it("单位向量自相似为 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("反方向向量相似度为 -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it("正交向量相似度为 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("L2 归一化后余弦相似度等于点积", () => {
    const a = normalize([3, 4]);
    const b = normalize([5, 12]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(dot(a, b), 9);
    expect(l2Norm(a)).toBeCloseTo(1, 9);
    expect(l2Norm(b)).toBeCloseTo(1, 9);
  });

  it("维度不匹配时抛出 RangeError", () => {
    expect(() => dot([1, 2], [1])).toThrow(
      new RangeError("向量维度不匹配"),
    );
    expect(() => cosineSimilarity([1, 2], [1])).toThrow(
      new RangeError("向量维度不匹配"),
    );
    expect(() => euclideanDistance([1, 2], [1])).toThrow(
      new RangeError("向量维度不匹配"),
    );
  });
});

describe("11.4 文档切分", () => {
  it("11.4.3 默认 chunkSize=500 时，1200 字文本切为 3 个 chunk", async () => {
    const text = "文".repeat(1200);
    const chunks = await chunkText(text);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.content.length <= 500)).toBe(true);
    for (const chunk of chunks) {
      expect(text.substring(chunk.startOffset, chunk.endOffset)).toBe(
        chunk.content,
      );
    }
  });

  it("11.4.4 重叠 50 字时，相邻 chunk 保留正确的重叠内容", async () => {
    const text = Array.from({ length: 1_200 }, (_, index) =>
      String.fromCharCode(0x4e00 + (index % 2_000)),
    ).join("");
    const chunks = await chunkText(text, { chunkSize: 500, chunkOverlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let index = 0; index < chunks.length - 1; index += 1) {
      expect(chunks[index].content.slice(-50)).toBe(
        chunks[index + 1].content.slice(0, 50),
      );
    }
  });

  it("11.4.5 优先在中文标点或换行处分割，不在词中截断", async () => {
    const text = "第一段需求说明。\n第二段需求说明。\n第三段需求说明。";
    const chunks = await chunkText(text, { chunkSize: 10, chunkOverlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(text.substring(chunk.startOffset, chunk.endOffset)).toBe(
        chunk.content,
      );
    }
    expect(
      chunks.slice(0, -1).every(
        (chunk) => chunk.content.endsWith("。") || chunk.content.endsWith("\n"),
      ),
    ).toBe(true);
  });

  it("11.4.7 Parent-Child 切分中，每个 child 都能找到所属 parent", async () => {
    const text = "需求内容".repeat(500);
    const { parents, children } = await chunkParentChild(text, 500, 200);

    expect(parents.length).toBeLessThan(children.length);
    for (const child of children) {
      const parent = parents[child.parentIndex];
      expect(parent).toBeDefined();
      expect(child.startOffset).toBeGreaterThanOrEqual(parent.startOffset);
      expect(child.endOffset).toBeLessThanOrEqual(parent.endOffset);
      expect(text.substring(child.startOffset, child.endOffset)).toBe(child.content);
    }
  });
});

describe("11.5 向量数据库", () => {
  const vectors = Array.from({ length: 50 }, (_, index) =>
    normalize([
      (index % 7) + 1,
      ((index * 3) % 11) + 1,
      ((index * 5) % 13) + 1,
      ((index * 7) % 17) + 1,
    ]),
  );
  const queryVector = normalize([3, 7, 2, 5]);

  function createKnnPrismaMock() {
    return {
      async $queryRaw<T>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<T> {
        const query = strings.join("?");
        if (query.includes("vector_dims")) {
          return [{ dimension: 4 }] as T;
        }

        const vectorLiteral = values[0] as string;
        const vector = vectorLiteral
          .slice(1, -1)
          .split(",")
          .map(Number);
        const topK = values.at(-1) as number;
        const rows = vectors
          .map((embedding, index) => ({
            id: `chunk-${index}`,
            documentId: `doc-${Math.floor(index / 5)}`,
            content: `内容 ${index}`,
            chunkIndex: index,
            modelName: "demo-embedding",
            distance: 1 - cosineSimilarity(embedding, vector),
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, topK);
        return rows as T;
      },
    };
  }

  it("11.5.2 小数据集上 KNN 暴力基线与 ANN 仓储检索结果一致", async () => {
    const topK = 8;
    const baseline = vectors
      .map((embedding, index) => ({
        id: `chunk-${index}`,
        score: cosineSimilarity(queryVector, embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const results = await similaritySearch(createKnnPrismaMock(), queryVector, {
      topK,
    });

    expect(results.map((result) => result.id)).toEqual(
      baseline.map((result) => result.id),
    );
  });

  it("11.5.6 pgvector 余弦 score 始终等于 1 - 距离", async () => {
    const results = await similaritySearch(
      createKnnPrismaMock(),
      queryVector,
      { topK: 3 },
    );

    for (const result of results) {
      const index = Number(result.id.replace("chunk-", ""));
      const expectedScore = cosineSimilarity(queryVector, vectors[index]);
      expect(result.score).toBeCloseTo(expectedScore, 12);
    }
  });

  it("查询向量维度与库中向量不一致时抛出 RangeError", async () => {
    await expect(
      similaritySearch(createKnnPrismaMock(), [1, 2, 3]),
    ).rejects.toThrow(new RangeError("向量维度不匹配"));
  });
});

describe("11.7 评估", () => {
  it("11.7.1 所有相关文档都位于 Top-K 时 Recall@K 为 1", () => {
    expect(recallAtK(["doc-a", "doc-b", "doc-c"], ["doc-a", "doc-b"], 2)).toBe(
      1,
    );
  });

  it("11.7.1 MRR 在第 1 位命中为 1，在第 2 位命中为 0.5", () => {
    expect(mrr([["doc-a", "doc-b"]], [["doc-a"]])).toBe(1);
    expect(mrr([["doc-a", "doc-b"]], [["doc-b"]])).toBe(0.5);
  });

  it("11.7.1 单个相关文档完全命中时 NDCG@K 为 1", () => {
    expect(ndcgAtK(["doc-a", "doc-b"], ["doc-a"], 2)).toBe(1);
  });

  it("11.7.3 RAGAS 服务不可用时告警并返回 null，不抛错", async () => {
    const warnings: string[] = [];
    const unavailableFetch = (async () => {
      throw new Error("RAGAS offline");
    }) as unknown as typeof fetch;

    const result = await runRagasEvaluation(
      {
        samples: [
          {
            question: "测试问题",
            answer: "测试回答",
            contexts: ["测试上下文"],
            ground_truth: "测试事实",
          },
        ],
        metrics: ["faithfulness"],
      },
      {
        baseUrl: "http://ragas.test",
        retries: 0,
        fetchFn: unavailableFetch,
        warn: (message) => warnings.push(message),
      },
    );

    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RAGAS");
  });
});

describe("11.10 集成 Agent", () => {
  it("allow 时工具将 ragAsk 的 answer 与 citations 序列化为 JSON 字符串", async () => {
    const ragTool = createRagTool({
      budgetUsedPercent: 30,
      resolveBudgetAction: () => ({ action: "allow", reason: "budget OK" }),
      ragAsk: async ({ question, topK }) => ({
        answer: `关于“${question}”的知识库回答`,
        citations: [{ documentId: "refund-policy", chunkIndex: 0, topK }],
      }),
    });

    const output = await ragTool.invoke({
      question: "蓝牙耳机未拆封可以退货吗？",
      topK: 3,
    });
    const result = JSON.parse(output as string) as {
      answer: string;
      citations: unknown[];
    };

    expect(result.answer).toContain("蓝牙耳机");
    expect(result.citations).toHaveLength(1);
  });

  it("reject 时在调用 ragAsk 前返回 budget_exceeded", async () => {
    let ragAskCalled = false;
    const ragTool = createRagTool({
      budgetUsedPercent: 110,
      resolveBudgetAction: () => ({
        action: "reject",
        reason: "budget exceeded",
      }),
      ragAsk: async () => {
        ragAskCalled = true;
        return { answer: "不应执行", citations: [] };
      },
    });

    const output = await ragTool.invoke({ question: "检索退款政策" });

    expect(JSON.parse(output as string)).toEqual({ error: "budget_exceeded" });
    expect(ragAskCalled).toBe(false);
  });

  it("工具描述明确包含“不适用”，避免闲聊场景误调用", () => {
    const ragTool = createRagTool({
      budgetUsedPercent: 0,
      ragAsk: async () => ({ answer: "", citations: [] }),
    });

    expect(RAG_TOOL_DESCRIPTION).toContain("不适用");
    expect(ragTool.description).toContain("不适用");
  });
});
