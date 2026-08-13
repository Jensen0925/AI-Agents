-- 记录每个向量块使用的嵌入模型，避免不同维度/模型的向量在检索时混用。
-- 默认值兼容既有文档分块写入流程；新仓储会显式写入 modelName。
ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "modelName" VARCHAR(100)
  NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
