export const DEFAULT_EMBEDDING_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/**
 * 向量维度契约。
 *
 * 这是「模型 ↔ 数据库列型 ↔ 检索」三方共享的常量：`document_chunks.embedding`
 * 声明为 `vector(384)`，数据库层因此会拒绝维度不符的写入；检索侧的
 * `DocumentEmbeddingService` 也会按该值校验并 L2 归一化。任何改动都必须同时
 * 配套一条 `ALTER COLUMN ... TYPE vector(n)` 迁移并重建 HNSW 索引。
 */
export const EMBEDDING_DIMENSION = 384;

export const LOCAL_EMBEDDING_MODEL =
  process.env["EMBEDDING_MODEL"]?.trim() || DEFAULT_EMBEDDING_MODEL;
