/**
 * pgvector 仓储层。
 *
 * Prisma 目前将 vector 标记为 Unsupported，因此这里仅通过 Prisma 的参数化原生
 * 查询读写，不引入额外的 pgvector 客户端依赖。
 */

export interface VectorStoreRecord {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
  modelName: string;
}

export interface SearchOptions {
  topK?: number;
  /** 可选的用户隔离条件；传入后只检索该用户拥有的文档。 */
  userId?: string;
  /** 可选的文档范围限制。 */
  documentId?: string;
}

export interface SearchResult {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  modelName: string;
  /** 余弦相似度，等于 `1 - (embedding <=> queryVector)`。 */
  score: number;
}

interface RawDimensionRow {
  dimension: number | string | null;
}

interface RawSearchResult {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  modelName: string;
  distance: number | string;
}

/** 满足 Prisma `$queryRaw` / `$executeRaw` 标签调用方式的最小接口，便于单测注入。 */
export interface VectorStorePrisma {
  $queryRaw<T>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

function assertVectorDimension(vector: number[], expectedDimension?: number): void {
  if (vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new RangeError("向量维度不匹配");
  }

  if (expectedDimension !== undefined && vector.length !== expectedDimension) {
    throw new RangeError("向量维度不匹配");
  }
}

function asVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * 批量写入向量块；同一 `(documentId, chunkIndex)` 已存在时覆盖其内容、向量与模型名。
 */
export async function upsertChunks(
  prisma: VectorStorePrisma,
  records: VectorStoreRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const dimension = records[0].embedding.length;
  for (const record of records) {
    assertVectorDimension(record.embedding, dimension);
  }

  for (const record of records) {
    const vectorLiteral = asVectorLiteral(record.embedding);
    await prisma.$queryRaw`
      INSERT INTO "document_chunks"
        ("id", "documentId", "content", "chunkIndex", "embedding", "modelName")
      VALUES
        (${record.id}, ${record.documentId}, ${record.content}, ${record.chunkIndex}, ${vectorLiteral}::vector, ${record.modelName})
      ON CONFLICT ("documentId", "chunkIndex")
      DO UPDATE SET
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "modelName" = EXCLUDED."modelName"
      RETURNING "id"
    `;
  }
}

/**
 * 使用 pgvector `<=>` 运算符执行余弦 KNN 检索。
 *
 * 在查询前读取已有向量维度，避免把不匹配的查询向量交给数据库后才获得不直观的
 * PostgreSQL 错误。空库没有可比较的维度，直接返回空结果。
 */
export async function similaritySearch(
  prisma: VectorStorePrisma,
  queryVector: number[],
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  assertVectorDimension(queryVector);

  const requestedTopK = options.topK ?? 5;
  if (!Number.isInteger(requestedTopK) || requestedTopK <= 0) {
    throw new RangeError("topK 必须是大于 0 的整数");
  }
  const topK = Math.min(requestedTopK, 100);

  const dimensionRows = await prisma.$queryRaw<RawDimensionRow[]>`
    SELECT vector_dims("embedding") AS "dimension"
    FROM "document_chunks"
    WHERE "embedding" IS NOT NULL
    LIMIT 1
  `;
  const dimension = Number(dimensionRows[0]?.dimension);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    return [];
  }
  assertVectorDimension(queryVector, dimension);

  const vectorLiteral = asVectorLiteral(queryVector);
  const rows = await prisma.$queryRaw<RawSearchResult[]>`
    SELECT
      chunks."id",
      chunks."documentId",
      chunks."content",
      chunks."chunkIndex",
      chunks."modelName",
      chunks."embedding" <=> ${vectorLiteral}::vector AS "distance"
    FROM "document_chunks" AS chunks
    INNER JOIN "documents" AS documents
      ON documents."id" = chunks."documentId"
    WHERE (${options.userId ?? null}::text IS NULL OR documents."userId" = ${options.userId ?? null})
      AND (${options.documentId ?? null}::text IS NULL OR chunks."documentId" = ${options.documentId ?? null})
    ORDER BY chunks."embedding" <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;

  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    content: row.content,
    chunkIndex: row.chunkIndex,
    modelName: row.modelName,
    score: 1 - Number(row.distance),
  }));
}
