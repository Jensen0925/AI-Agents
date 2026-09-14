/**
 * 检索评测的共享 corpus 与 gold 标注。
 *
 * 被两处消费，保证「离线评测」与「数据库级评测」不会各写一份而慢慢漂移：
 * - `test/retrieval-eval.spec.ts`：不依赖 PostgreSQL，在 CI 中评测生产检索链路；
 * - `scripts/run-retrieval-eval.ts`：落到真实 pgvector + 真实 embedding 上跑。
 *
 * chunk id 是评测与生产的对齐锚点：`SearchService` 必须把
 * `document_chunks.id` 原样透传，`relevantChunkIds` 才能匹配上。
 */

export const RETRIEVAL_FIXTURE_USER_ID = "eval-retrieval-user";

/** 用于 `--keep` 之外的清理：所有 fixture 行的 id 都带这个前缀。 */
export const RETRIEVAL_FIXTURE_PREFIX = "eval-retrieval-";

export interface RetrievalFixtureChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
}

/** 三个主题、每主题两块，分属同一文档的两个 chunkIndex 位置。 */
export const RETRIEVAL_FIXTURE_CHUNKS: readonly RetrievalFixtureChunk[] = [
  {
    id: "eval-retrieval-chunk-login-0",
    documentId: "eval-retrieval-doc-login",
    chunkIndex: 0,
    content: "用户登录支持手机号与密码，连续失败五次锁定账户三十分钟",
  },
  {
    id: "eval-retrieval-chunk-login-1",
    documentId: "eval-retrieval-doc-login",
    chunkIndex: 1,
    content: "登录失败次数与账户锁定策略需写入安全审计日志",
  },
  {
    id: "eval-retrieval-chunk-refund-0",
    documentId: "eval-retrieval-doc-refund",
    chunkIndex: 0,
    content: "蓝牙耳机未拆封支持七天无理由退货",
  },
  {
    id: "eval-retrieval-chunk-refund-1",
    documentId: "eval-retrieval-doc-refund",
    chunkIndex: 1,
    content: "退货申请需在签收后七天内提交，逾期不予受理",
  },
  {
    id: "eval-retrieval-chunk-payment-0",
    documentId: "eval-retrieval-doc-payment",
    chunkIndex: 0,
    content: "支付回调必须做幂等处理，重复通知只入账一次",
  },
  {
    id: "eval-retrieval-chunk-payment-1",
    documentId: "eval-retrieval-doc-payment",
    chunkIndex: 1,
    content: "支付通知重复到达时不得重复扣款",
  },
];

export interface RetrievalFixtureQuery {
  id: string;
  input: string;
  relevantChunkIds: string[];
}

export const RETRIEVAL_FIXTURE_QUERIES: readonly RetrievalFixtureQuery[] = [
  {
    id: "retrieval-login",
    input: "登录失败如何锁定账户",
    relevantChunkIds: [
      "eval-retrieval-chunk-login-0",
      "eval-retrieval-chunk-login-1",
    ],
  },
  {
    id: "retrieval-refund",
    input: "蓝牙耳机退货规则",
    relevantChunkIds: [
      "eval-retrieval-chunk-refund-0",
      "eval-retrieval-chunk-refund-1",
    ],
  },
  {
    id: "retrieval-payment",
    input: "支付回调重复通知怎么处理",
    relevantChunkIds: [
      "eval-retrieval-chunk-payment-0",
      "eval-retrieval-chunk-payment-1",
    ],
  },
];

/** 评测使用的 Top-K。与每个 query 的 gold 数量一致，便于用 precision 直接读数。 */
export const RETRIEVAL_FIXTURE_TOP_K = 2;

/** fixture 涉及的文档（documentId 去重），数据库级评测需要先落 documents 行。 */
export function retrievalFixtureDocuments(): Array<{
  id: string;
  filename: string;
}> {
  return [...new Set(RETRIEVAL_FIXTURE_CHUNKS.map((chunk) => chunk.documentId))]
    .sort()
    .map((id) => ({ id, filename: `${id}.txt` }));
}
