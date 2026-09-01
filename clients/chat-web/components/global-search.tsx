"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { CornerDownLeft, FileText, Loader2, Search, X } from "lucide-react"
import { api, apiErrorMessage } from "@/lib/api"
import type { KnowledgeDoc } from "@/lib/knowledge-data"
import { cn } from "@/lib/utils"

/** 与后端 DocumentSearchResult 对齐，仅取前端渲染所需字段。 */
type SearchHit = {
  id?: string
  documentId?: string
  content: string
  score: number
}

const DEFAULT_TOP_K = 8
const DEBOUNCE_MS = 300

type GlobalSearchProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: KnowledgeDoc[]
  demo: boolean
  onSelectDocument: (document: KnowledgeDoc) => void
}

export function GlobalSearch({
  open,
  onOpenChange,
  documents,
  demo,
  onSelectDocument,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  )

  // 打开时聚焦输入框；关闭时清空结果，避免下次打开闪现上一次的内容。
  useEffect(() => {
    if (!open) {
      setQuery("")
      setHits([])
      setError("")
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    const keyword = query.trim()
    if (!open || keyword.length === 0) {
      setHits([])
      setError("")
      setLoading(false)
      return
    }

    // 演示账号没有真实向量索引，退化为在已加载文档里做标题/摘要/标签匹配。
    if (demo) {
      setLoading(false)
      setError("")
      const lower = keyword.toLowerCase()
      setHits(
        documents
          .filter(
            (document) =>
              document.title.toLowerCase().includes(lower) ||
              document.summary.toLowerCase().includes(lower) ||
              document.tags.some((tag) => tag.toLowerCase().includes(lower)),
          )
          .slice(0, DEFAULT_TOP_K)
          .map((document) => ({
            documentId: document.id,
            content: document.summary,
            score: 1,
          })),
      )
      return
    }

    setLoading(true)
    setError("")
    const timer = window.setTimeout(() => {
      void api
        .post<SearchHit[]>("/search", { query: keyword, topK: DEFAULT_TOP_K })
        .then(({ data }) => {
          setHits(Array.isArray(data) ? data : [])
        })
        .catch((reason: unknown) => {
          setHits([])
          setError(apiErrorMessage(reason))
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [demo, documents, open, query])

  const hasIndexedDocuments = documents.some(
    (document) => (document.chunkCount ?? 0) > 0,
  )

  function select(hit: SearchHit) {
    const document = hit.documentId ? documentsById.get(hit.documentId) : undefined
    if (!document) return
    onSelectDocument(document)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl focus:outline-none">
          <Dialog.Title className="sr-only">全局检索</Dialog.Title>
          <Dialog.Description className="sr-only">
            在全部已索引文档中做语义检索，Enter 打开首个结果
          </Dialog.Description>

          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hits.length > 0) {
                  event.preventDefault()
                  select(hits[0])
                }
              }}
              placeholder="检索规则条款…"
              className="h-14 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">
              Esc
            </kbd>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭检索"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="pretty-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 正在检索
              </div>
            ) : error ? (
              <div className="px-3 py-8 text-center text-sm text-destructive">{error}</div>
            ) : query.trim() && hits.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {hasIndexedDocuments
                  ? "没有命中相关片段，换个说法试试"
                  : "还没有已索引的文档，先上传并处理文档后再检索"}
              </div>
            ) : hits.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                输入关键词开始检索
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {hits.map((hit, index) => {
                  const document = hit.documentId
                    ? documentsById.get(hit.documentId)
                    : undefined
                  return (
                    <li key={hit.id ?? `${hit.documentId}-${index}`}>
                      <button
                        type="button"
                        onClick={() => select(hit)}
                        className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                      >
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <FileText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {document?.title ?? "未知文档"}
                            </span>
                            {typeof hit.score === "number" && (
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[11px]",
                                  hit.score >= 0.6
                                    ? "bg-chart-3/15 text-chart-3"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {hit.score.toFixed(2)}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                            {hit.content}
                          </span>
                        </span>
                        <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {demo ? "演示模式：仅匹配标题与摘要" : `语义检索 · Top ${DEFAULT_TOP_K}`}
            </span>
            <span>Enter 打开首个结果</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
