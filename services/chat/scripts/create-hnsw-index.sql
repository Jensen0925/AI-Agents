-- pgvector HNSW 余弦索引。
-- 请在 document_chunks 的历史向量全量入库后再执行，以避免建索引期间的额外维护成本。
-- 执行前请在目标环境确认 pgvector 扩展与 PostgreSQL 版本均支持 HNSW。

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_cosine_idx"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
