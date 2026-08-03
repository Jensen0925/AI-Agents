export type DocStatus = "已索引" | "处理中" | "待处理" | "处理失败"

export type KnowledgeDoc = {
  id: string
  title: string
  category: string
  type: "PDF" | "Markdown" | "Word" | "网页" | "表格"
  summary: string
  updatedAt: string
  size: string
  status: DocStatus
  tags: string[]
  views: number
  rawStatus?: string
  chunkCount?: number
  createdAt?: string
}

export type Category = {
  id: string
  name: string
  count: number
}

export const categories: Category[] = [
  { id: "all", name: "全部文档", count: 42 },
  { id: "product", name: "产品文档", count: 14 },
  { id: "engineering", name: "技术规范", count: 11 },
  { id: "hr", name: "人事制度", count: 7 },
  { id: "sales", name: "销售手册", count: 6 },
  { id: "design", name: "设计指南", count: 4 },
]

export type DocumentRecord = {
  id: string
  filename: string
  mimeType: string
  size: number
  status: string
  chunkCount: number
  createdAt: string
  filePath?: string | null
}

export const categoryDefinitions = categories.map(({ id, name }) => ({ id, name }))

export function inferDocumentCategory(filename: string): string {
  const value = filename.toLowerCase()
  if (/设计|ui|ux|视觉|组件|样式|交互/.test(value)) return "design"
  if (/员工|人事|考勤|绩效|福利|招聘|薪酬/.test(value)) return "hr"
  if (/销售|市场|客户|报价|商务|营销/.test(value)) return "sales"
  if (/技术|架构|api|接口|开发|数据库|安全|部署|运维|代码|规范/.test(value)) return "engineering"
  return "product"
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatRelativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime()
  const hours = Math.max(0, Math.floor(elapsed / 3_600_000))
  if (hours < 1) return "刚刚"
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return "昨天"
  if (days < 7) return `${days} 天前`
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value))
}

function documentType(mimeType: string): KnowledgeDoc["type"] {
  if (mimeType.includes("pdf")) return "PDF"
  if (mimeType.includes("word") || mimeType.includes("document")) return "Word"
  return "Markdown"
}

function documentStatus(status: string): DocStatus {
  if (status === "done") return "已索引"
  if (status === "processing") return "处理中"
  if (status === "error") return "处理失败"
  return "待处理"
}

export function mapDocumentRecord(record: DocumentRecord): KnowledgeDoc {
  const status = documentStatus(record.status)
  return {
    id: record.id,
    title: record.filename,
    category: inferDocumentCategory(record.filename),
    type: documentType(record.mimeType),
    summary:
      record.status === "done"
        ? `该文档已由 CloudSage 解析为 ${record.chunkCount} 个知识片段，可用于语义检索与 AI 问答。`
        : record.status === "processing"
          ? "CloudSage 正在解析文档内容并构建向量索引。"
          : record.status === "error"
            ? "文档处理失败，可重新触发解析与向量化。"
            : "文档已上传，等待解析、分块和向量化处理。",
    updatedAt: formatRelativeDate(record.createdAt),
    size: formatBytes(record.size),
    status,
    tags: [documentType(record.mimeType), status, `${record.chunkCount} chunks`],
    views: 0,
    rawStatus: record.status,
    chunkCount: record.chunkCount,
    createdAt: record.createdAt,
  }
}

export function buildCategories(items: KnowledgeDoc[]): Category[] {
  return categoryDefinitions.map((category) => ({
    ...category,
    count:
      category.id === "all"
        ? items.length
        : items.filter((document) => document.category === category.id).length,
  }))
}

export const documents: KnowledgeDoc[] = [
  {
    id: "d1",
    title: "产品需求文档 · 智能助手 V3.0",
    category: "product",
    type: "PDF",
    summary: "详细描述智能助手 V3.0 的功能范围、用户故事、交互流程与验收标准，涵盖多轮对话与知识引用能力。",
    updatedAt: "2 小时前",
    size: "2.4 MB",
    status: "已索引",
    tags: ["需求", "V3.0", "对话"],
    views: 328,
  },
  {
    id: "d2",
    title: "后端服务架构设计规范",
    category: "engineering",
    type: "Markdown",
    summary: "微服务拆分原则、服务间通信协议、数据库选型与容灾方案，包含 API 网关与鉴权中心的详细设计。",
    updatedAt: "昨天",
    size: "860 KB",
    status: "已索引",
    tags: ["架构", "微服务", "后端"],
    views: 512,
  },
  {
    id: "d3",
    title: "2026 员工手册与考勤制度",
    category: "hr",
    type: "Word",
    summary: "公司最新考勤、请假、绩效与福利制度说明，适用于全体正式员工，含弹性工作制细则。",
    updatedAt: "3 天前",
    size: "1.1 MB",
    status: "已索引",
    tags: ["考勤", "制度", "福利"],
    views: 1204,
  },
  {
    id: "d4",
    title: "企业级销售话术与异议处理",
    category: "sales",
    type: "PDF",
    summary: "针对大客户场景的标准销售流程、常见异议应对话术，以及竞品对比要点与报价策略。",
    updatedAt: "5 天前",
    size: "3.2 MB",
    status: "处理中",
    tags: ["销售", "话术", "大客户"],
    views: 289,
  },
  {
    id: "d5",
    title: "设计系统组件规范 2.0",
    category: "design",
    type: "网页",
    summary: "统一的颜色、字体、间距与组件用法规范，包含无障碍设计要求与暗色模式适配指南。",
    updatedAt: "1 周前",
    size: "—",
    status: "已索引",
    tags: ["设计系统", "组件", "规范"],
    views: 673,
  },
  {
    id: "d6",
    title: "数据埋点与指标口径说明表",
    category: "engineering",
    type: "表格",
    summary: "全站核心事件埋点定义、上报字段说明与关键业务指标的统一计算口径，供数据与研发团队对齐。",
    updatedAt: "1 周前",
    size: "540 KB",
    status: "待处理",
    tags: ["埋点", "指标", "数据"],
    views: 156,
  },
  {
    id: "d7",
    title: "新用户引导流程优化方案",
    category: "product",
    type: "Markdown",
    summary: "基于漏斗分析提出的新用户激活优化方案，包含引导步骤重构、空状态设计与 A/B 实验计划。",
    updatedAt: "2 周前",
    size: "420 KB",
    status: "已索引",
    tags: ["增长", "引导", "激活"],
    views: 401,
  },
  {
    id: "d8",
    title: "接口安全与鉴权最佳实践",
    category: "engineering",
    type: "PDF",
    summary: "OAuth 2.0 与 JWT 的落地实践、密钥轮换策略、常见安全漏洞防护清单与安全评审流程。",
    updatedAt: "3 周前",
    size: "1.8 MB",
    status: "已索引",
    tags: ["安全", "鉴权", "OAuth"],
    views: 344,
  },
]

export type Citation = {
  docId: string
  title: string
  snippet: string
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
}

export const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content: "智能助手 V3.0 支持多轮对话吗？有哪些关键能力？",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "是的，智能助手 V3.0 支持多轮上下文对话。根据产品需求文档，其关键能力包括：\n\n1. 多轮对话与上下文记忆，可在同一会话中连续追问；\n2. 知识引用能力，回答会标注来源文档；\n3. 支持文档、表格、网页等多种知识格式的检索。\n\n验收标准要求在多轮场景下上下文保留率不低于 95%。",
    citations: [
      {
        docId: "d1",
        title: "产品需求文档 · 智能助手 V3.0",
        snippet: "系统需支持多轮对话与知识引用能力，上下文保留率不低于 95%……",
      },
    ],
  },
]

export const suggestedQuestions = [
  "公司的弹性工作制是怎么规定的？",
  "后端微服务的拆分原则有哪些？",
  "接口鉴权推荐用什么方案？",
  "新用户引导优化的核心思路是什么？",
]
