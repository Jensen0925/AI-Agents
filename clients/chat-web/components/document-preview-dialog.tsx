"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  Download,
  ExternalLink,
  FileQuestion,
  FileText,
  X,
} from "lucide-react"
import { api, apiErrorMessage } from "@/lib/api"
import {
  getDocumentPreviewKind,
  type DocumentPreviewKind,
} from "@/lib/document-preview"
import type { KnowledgeDoc } from "@/lib/knowledge-data"
import { Button } from "@/components/ui/button"

type DocumentPreviewDialogProps = {
  document: KnowledgeDoc | null
  open: boolean
  demo: boolean
  onOpenChange: (open: boolean) => void
}

function PreviewSpinner() {
  return (
    <div
      role="status"
      aria-label="正在加载文档预览"
      className="relative size-9 animate-spin rounded-full bg-[conic-gradient(from_315deg,rgba(255,255,255,0.35),rgba(94,101,98,0.9),transparent_82%)] p-[2px] [animation-duration:1.15s]"
    >
      <div className="size-full rounded-full bg-background/95 backdrop-blur-sm" />
    </div>
  )
}

function SafeMarkdownPreview({ content }: { content: string }) {
  let inCodeBlock = false

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-7 text-[15px] leading-7 text-foreground sm:px-8 sm:py-10">
      {content.split(/\r?\n/).map((line, index) => {
        if (line.trim().startsWith("```")) {
          inCodeBlock = !inCodeBlock
          return (
            <div
              key={`${index}-${line}`}
              className={inCodeBlock ? "mt-5" : "mb-5"}
            />
          )
        }
        if (inCodeBlock) {
          return (
            <pre
              key={`${index}-${line}`}
              className="overflow-x-auto bg-secondary px-4 py-1 font-mono text-sm text-secondary-foreground first:rounded-t-xl last:rounded-b-xl"
            >
              {line || " "}
            </pre>
          )
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          const classes =
            level === 1
              ? "mb-4 mt-2 text-2xl font-semibold"
              : level === 2
                ? "mb-3 mt-7 text-xl font-semibold"
                : "mb-2 mt-6 text-base font-semibold"
          return (
            <div key={`${index}-${line}`} className={classes}>
              {heading[2]}
            </div>
          )
        }

        const bullet = /^\s*[-*+]\s+(.+)$/.exec(line)
        if (bullet) {
          return (
            <div key={`${index}-${line}`} className="flex gap-3 pl-2">
              <span aria-hidden className="text-primary">
                •
              </span>
              <span>{bullet[1]}</span>
            </div>
          )
        }

        const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line)
        if (numbered) {
          return (
            <div key={`${index}-${line}`} className="flex gap-3 pl-2">
              <span className="min-w-5 text-right text-muted-foreground">
                {numbered[1]}.
              </span>
              <span>{numbered[2]}</span>
            </div>
          )
        }

        if (line.startsWith(">")) {
          return (
            <blockquote
              key={`${index}-${line}`}
              className="my-3 border-l-2 border-primary/60 pl-4 text-muted-foreground"
            >
              {line.replace(/^>\s?/, "")}
            </blockquote>
          )
        }

        if (!line.trim()) {
          return <div key={`${index}-blank`} className="h-4" />
        }

        return <p key={`${index}-${line}`}>{line}</p>
      })}
    </div>
  )
}

export function DocumentPreviewDialog({
  document,
  open,
  demo,
  onOpenChange,
}: DocumentPreviewDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [content, setContent] = useState("")
  const [objectUrl, setObjectUrl] = useState("")
  const [previewKind, setPreviewKind] =
    useState<DocumentPreviewKind>("unsupported")

  useEffect(() => {
    let disposed = false
    let createdObjectUrl = ""

    setLoading(false)
    setError("")
    setContent("")
    setObjectUrl("")

    if (!open || !document) {
      return () => {
        disposed = true
      }
    }

    const initialKind = getDocumentPreviewKind(
      document.mimeType,
      document.title,
    )
    setPreviewKind(initialKind)

    if (demo) {
      setPreviewKind("text")
      setContent(
        `# ${document.title}\n\n${document.summary}\n\n> 这是演示账号的示例内容。上传真实的 Markdown、TXT 或 PDF 文件后，可以在这里查看完整原文。`,
      )
      return () => {
        disposed = true
      }
    }

    setLoading(true)
    void api
      .get<Blob>(`/documents/${document.id}/preview`, {
        responseType: "blob",
      })
      .then(async (response) => {
        if (disposed) return
        const blob = response.data
        const responseMimeType =
          String(response.headers["content-type"] ?? "") || blob.type
        const resolvedKind = getDocumentPreviewKind(
          responseMimeType || document.mimeType,
          document.title,
        )
        createdObjectUrl = URL.createObjectURL(blob)

        if (resolvedKind === "text") {
          const text = await blob.text()
          if (disposed) return
          setContent(text)
        }

        if (!disposed) {
          setPreviewKind(resolvedKind)
          setObjectUrl(createdObjectUrl)
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(apiErrorMessage(reason))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl)
    }
  }, [demo, document, open])

  function downloadDocument() {
    if (!document || !objectUrl) return
    const link = window.document.createElement("a")
    link.href = objectUrl
    link.download = document.title
    link.click()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-2 z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl focus:outline-none sm:inset-5 lg:inset-8">
          <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 py-3 sm:px-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <FileText className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-semibold text-foreground sm:text-base">
                {document?.title ?? "文档预览"}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {document ? `${document.type} · ${document.size}` : "正在准备文档"}
              </Dialog.Description>
            </div>
            {!demo && objectUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={downloadDocument}
              >
                <Download className="size-4" />
                <span className="hidden sm:inline">下载</span>
              </Button>
            )}
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭文档预览"
              >
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto bg-secondary/35">
            {loading ? (
              <div className="flex h-full min-h-64 items-center justify-center">
                <PreviewSpinner />
              </div>
            ) : error ? (
              <div className="flex h-full min-h-64 items-center justify-center p-6 text-center">
                <div className="max-w-md">
                  <FileQuestion className="mx-auto size-8 text-destructive" />
                  <p className="mt-3 text-sm font-medium text-foreground">
                    无法打开文档
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
            ) : previewKind === "pdf" && objectUrl ? (
              <iframe
                src={objectUrl}
                title={`${document?.title ?? "文档"} PDF 预览`}
                className="h-full min-h-[70vh] w-full border-0 bg-background"
              />
            ) : previewKind === "text" ? (
              <SafeMarkdownPreview content={content} />
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center p-6 text-center">
                <div className="max-w-md">
                  <FileQuestion className="mx-auto size-9 text-muted-foreground" />
                  <p className="mt-4 text-sm font-medium text-foreground">
                    当前格式暂不支持在线预览
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Word 等格式在浏览器中的显示效果不稳定，你可以下载原文件后查看。
                  </p>
                  {objectUrl && (
                    <Button
                      type="button"
                      className="mt-5 gap-2"
                      onClick={downloadDocument}
                    >
                      <ExternalLink className="size-4" />
                      下载原文件
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
