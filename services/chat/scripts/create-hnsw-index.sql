-- pgvector HNSW 余弦索引。
--
-- 该索引现在已经进入 drizzle 迁移：`drizzle/0002_flaky_stature.sql`
-- （索引名 "document_chunks_embedding_hnsw_idx"，算子类 vector_cosine_ops，
--  与检索侧的 `embedding <=> $1` 一致）。**新环境直接执行 `pnpm db:migrate` 即可，
--  不要再跑本脚本**，否则会多出一个同构索引，写放大翻倍。
--
-- 仅在以下两种场景使用本脚本：
--   1) 旧环境曾手工执行过历史版本脚本，库里存在旧名称索引，需要对齐命名；
--   2) 超大表需要在迁移之外以 CONCURRENTLY 建索引，避免 CREATE INDEX 期间的写锁。

CREATE EXTENSION IF NOT EXISTS vector;

-- 清理历史脚本创建的重名索引（旧名称带 _cosine_ 后缀）。
DROP INDEX IF EXISTS "document_chunks_embedding_hnsw_cosine_idx";

-- CONCURRENTLY 不能在事务块内执行，因此不能放进 drizzle 迁移。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "document_chunks_embedding_hnsw_idx"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
