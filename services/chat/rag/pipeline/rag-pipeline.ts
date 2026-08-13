import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  similaritySearch,
  type SearchResult,
  type VectorStorePrisma,
} from "../retrieval/vector-store";

export interface RagAskInput {
  question: string;
  userId: string;
  topK?: number;
  model: BaseChatModel;
  /**
   * 查询向量化能力由调用方注入，避免 RAG pipeline 绑定到特定 embedding provider。
   * 当前项目可传入 DocumentEmbeddingService.embedTexts 的单文本包装函数。
   */
  embedQuery: (question: string) => Promise<number[]>;
  /** pgvector 仓储依赖；使用最小 Prisma 原生查询接口，便于测试替换。 */
  prisma: VectorStorePrisma;
}

export interface RagAskOutput {
  answer: string;
  citations: Array<{
    chunkId: string;
    documentId: string;
    score: number;
  }>;
  /** 检索层的原始块结果，用于调试、评估与后续 UI 展示。 */
  retrievedChunks: SearchResult[];
}

export const RAG_SYSTEM_PROMPT = `你是一个基于知识库的问答助手。请严格根据[上下文]回答用户问题。

规则：
- 只用上下文中的信息回答，不要凭借常识或推测
- 如果上下文不足以回答，明确说"根据提供的资料，我无法确定..."
- 每句结论后用 [chunkId] 标注引用来源
- 简洁清晰，最多 5 段`;

function responseContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part === "object" && part && "text" in part
            ? String(part.text ?? "")
            : "",
      )
      .join("");
  }
  return String(content ?? "");
}

/**
 * 标准 RAG 问答流水线：查询向量化 → 用户隔离的 pgvector 检索 → 受限上下文生成。
 *
 * 若知识库没有命中，仍调用模型，但系统提示明确要求模型只按上下文回答，因此它应
 * 返回资料不足的说明，而不是依赖通用知识编造结论。
 */
export async function ragAsk(input: RagAskInput): Promise<RagAskOutput> {
  const { question, userId, topK = 5, model, embedQuery, prisma } = input;
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new Error("question must be a non-empty string");
  }

  // Step 1: 向量化并检索；userId 作为数据库过滤条件，保证知识库用户隔离。
  const queryVector = await embedQuery(normalizedQuestion);
  const chunks = await similaritySearch(prisma, queryVector, {
    userId,
    topK,
  });

  // Step 2: 拼接受引用 ID 标记的 Prompt 上下文。
  const contextBlock = chunks
    .map(
      (chunk) =>
        `[chunkId:${chunk.id}, 来源:${chunk.documentId}, 相关性:${chunk.score.toFixed(2)}]\n${chunk.content}`,
    )
    .join("\n\n---\n\n");
  const userMessage = `[上下文]\n${contextBlock || "（未检索到相关资料）"}\n\n[用户问题]\n${normalizedQuestion}`;

  // Step 3: LLM 仅依据检索上下文生成最终回答。
  const response = await model.invoke([
    new SystemMessage(RAG_SYSTEM_PROMPT),
    new HumanMessage(userMessage),
  ]);

  return {
    answer: responseContentToText(response.content),
    citations: chunks.map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      score: chunk.score,
    })),
    retrievedChunks: chunks,
  };
}
