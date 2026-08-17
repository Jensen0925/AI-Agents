"use client"

import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { Category, DocStatus, KnowledgeDoc } from "@/lib/knowledge-data"
import { Button } from "@/components/ui/button"
import {
  FileSpreadsheet,
  FileText,
  Globe,
  Eye,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react"

const typeIcon: Record<KnowledgeDoc["type"], React.ReactNode> = {
  PDF: <FileText className="size-5" />,
  Markdown: <FileText className="size-5" />,
  Word: <FileText className="size-5" />,
  网页: <Globe className="size-5" />,
  表格: <FileSpreadsheet className="size-5" />,
}

const statusStyle: Record<DocStatus, string> = {
  已索引: "bg-chart-3/15 text-chart-3",
  处理中: "bg-chart-4/15 text-chart-4",
  待处理: "bg-muted text-muted-foreground",
  处理失败: "bg-destructive/15 text-destructive",
}

type DocumentsViewProps = {
  documents: KnowledgeDoc[]
  categories: Category[]
  activeCategory: string
  onCategoryChange: (id: string) => void
  loading: boolean
  error: string
  uploading: boolean
  onUpload: (file: File) => Promise<void>
  onProcess: (document: KnowledgeDoc) => Promise<void>
  onDelete: (document: KnowledgeDoc) => Promise<void>
  onPreview: (document: KnowledgeDoc) => void
}

export function DocumentsView({
  documents,
  categories,
  activeCategory,
  onCategoryChange,
  loading,
  error,
  uploading,
  onUpload,
  onProcess,
  onDelete,
  onPreview,
}: DocumentsViewProps) {
  const [query, setQuery] = useState("")
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    return documents.filter((doc) => {
      const matchCat = activeCategory === "all" || doc.category === activeCategory
      const q = query.trim().toLowerCase()
      const matchQuery =
        q === "" ||
        doc.title.toLowerCase().includes(q) ||
        doc.summary.toLowerCase().includes(q) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(q))
      return matchCat && matchQuery
    })
  }, [activeCategory, documents, query])

  const activeName = categories.find((category) => category.id === activeCategory)?.name ?? "全部文档"

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) await onUpload(file)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-balance text-xl font-semibold text-foreground">{activeName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {filtered.length} 篇文档 · 由 AI 自动索引与摘要
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.markdown,.pdf,.doc,.docx,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => void selectFile(event)}
          />
          <Button
            size="lg"
            className="gap-2"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? "正在上传" : "上传文档"}
          </Button>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文档标题、内容或标签…"
              className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1">
            <button
              type="button"
              onClick={() => setLayout("grid")}
              aria-label="网格视图"
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition-colors",
                layout === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setLayout("list")}
              aria-label="列表视图"
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition-colors",
                layout === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onCategoryChange(category.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === category.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" /> 正在加载文档
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <Search className="size-6" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">未找到相关文档</p>
            <p className="mt-1 text-sm text-muted-foreground">上传文档，或试试其他关键词和分类</p>
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((document) => (
              <DocCard key={document.id} document={document} onProcess={onProcess} onDelete={onDelete} onPreview={onPreview} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((document) => (
              <DocRow key={document.id} document={document} onProcess={onProcess} onDelete={onDelete} onPreview={onPreview} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type DocumentActions = {
  document: KnowledgeDoc
  onProcess: (document: KnowledgeDoc) => Promise<void>
  onDelete: (document: KnowledgeDoc) => Promise<void>
  onPreview: (document: KnowledgeDoc) => void
}

function ActionButtons({ document, onProcess, onDelete, onPreview }: DocumentActions) {
  const processing = document.rawStatus === "processing"
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onPreview(document)
        }}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        title="预览文档"
        aria-label="预览文档"
      >
        <Eye className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={processing}
        onClick={(event) => {
          event.stopPropagation()
          void onProcess(document)
        }}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        title={processing ? "正在处理" : "重新处理"}
        aria-label={processing ? "正在处理" : "重新处理"}
      >
        <RefreshCw className={cn("size-3.5", processing && "animate-spin")} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          void onDelete(document)
        }}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        title="删除文档"
        aria-label="删除文档"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function DocCard(props: DocumentActions) {
  const { document } = props
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`预览文档 ${document.title}`}
      onClick={() => props.onPreview(document)}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          props.onPreview(document)
        }
      }}
      className="group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:border-ring/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          {typeIcon[document.type]}
        </div>
        <div className="flex items-center gap-2">
          <ActionButtons {...props} />
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusStyle[document.status])}>
            {document.status}
          </span>
        </div>
      </div>
      <h3 className="mt-4 text-pretty text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
        {document.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{document.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {document.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{document.type} · {document.size}</span>
        <span>{document.updatedAt}</span>
      </div>
    </article>
  )
}

function DocRow(props: DocumentActions) {
  const { document } = props
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`预览文档 ${document.title}`}
      onClick={() => props.onPreview(document)}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          props.onPreview(document)
        }
      }}
      className="group flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-all hover:border-ring/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        {typeIcon[document.type]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{document.title}</h3>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", statusStyle[document.status])}>
            {document.status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{document.summary}</p>
      </div>
      <div className="hidden shrink-0 items-center gap-6 text-xs text-muted-foreground sm:flex">
        <span className="w-16 text-right">{document.type}</span>
        <span className="w-16 text-right">{document.updatedAt}</span>
        <ActionButtons {...props} />
      </div>
    </article>
  )
}
