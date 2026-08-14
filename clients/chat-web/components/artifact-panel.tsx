"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText, History, Loader2, Pencil, RotateCcw, Save, Sparkles } from "lucide-react"
import { api, apiErrorMessage } from "@/lib/api"
import { getSession } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"

type ArtifactVersion = {
  id: string
  version: number
  content: string
  changelog?: string | null
  sourceTags: string[]
  createdAt: string
}

export type Artifact = {
  id: string
  conversationId: string
  title: string
  content: string
  currentVersion: number
  versions?: ArtifactVersion[]
}

type ArtifactPanelProps = {
  conversationId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  refreshKey: number
  onAvailabilityChange: (available: boolean) => void
  onTitleChange?: (title: string) => void
}

/**
 * 会话报告的轻量工作区。它只依赖现有 REST API：查看、人工编辑、版本回退
 * 和流式优化都在这里收口，不向聊天状态引入第二套全局 store。
 */
export function ArtifactPanel({
  conversationId,
  open,
  onOpenChange,
  refreshKey,
  onAvailabilityChange,
  onTitleChange,
}: ArtifactPanelProps) {
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [content, setContent] = useState("")
  const [title, setTitle] = useState("")
  const [editing, setEditing] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [instruction, setInstruction] = useState("")
  const [optimizing, setOptimizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const dirty = Boolean(artifact && (content !== artifact.content || title.trim() !== artifact.title))
  const sortedVersions = useMemo(
    () => [...versions].sort((left, right) => right.version - left.version),
    [versions],
  )

  async function loadArtifact() {
    if (!conversationId) {
      setArtifact(null)
      setContent("")
      setTitle("")
      setVersions([])
      onAvailabilityChange(false)
      return
    }

    try {
      setError("")
      const { data } = await api.get<Artifact | null>(`/artifacts/conversation/${conversationId}`)
      setArtifact(data)
      setContent(data?.content ?? "")
      setTitle(data?.title ?? "")
      setVersions(data?.versions ?? [])
      onAvailabilityChange(Boolean(data))
    } catch (reason) {
      // 工件工作区是聊天的可选增强。请求失败时保持面板不可用即可，不能把
      // 与聊天无关的旁路错误变成用户可见的红色错误状态。
      setArtifact(null)
      setContent("")
      setTitle("")
      setVersions([])
      onAvailabilityChange(false)
      setError("")
      console.warn("Unable to load conversation artifact", apiErrorMessage(reason))
    }
  }

  useEffect(() => {
    setEditing(false)
    setVersionsOpen(false)
    void loadArtifact()
    // refreshKey 在新分析完成后递增，促使面板读取刚持久化的报告。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, refreshKey])

  async function loadVersions() {
    if (!artifact) return
    try {
      const { data } = await api.get<ArtifactVersion[]>(`/artifacts/${artifact.id}/versions`)
      setVersions(data)
    } catch (reason) {
      setError(apiErrorMessage(reason))
    }
  }

  async function save() {
    if (!artifact || !dirty || saving) return
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError("报告标题不能为空")
      return
    }

    setSaving(true)
    setError("")
    try {
      let nextArtifact = artifact
      if (content !== artifact.content) {
        const { data } = await api.put<Artifact>(`/artifacts/${artifact.id}`, {
          content,
          changelog: "在报告工作区中编辑",
        })
        nextArtifact = data
      }
      if (nextTitle !== nextArtifact.title) {
        const { data } = await api.patch<Artifact>(`/artifacts/${artifact.id}/title`, {
          title: nextTitle,
        })
        nextArtifact = { ...nextArtifact, ...data }
      }
      setArtifact(nextArtifact)
      setContent(nextArtifact.content)
      setTitle(nextArtifact.title)
      onTitleChange?.(nextArtifact.title)
      setEditing(false)
      await loadVersions()
    } catch (reason) {
      setError(apiErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function revert(version: ArtifactVersion) {
    if (!artifact || saving) return
    if (!window.confirm(`恢复到版本 ${version.version}？此操作会创建一个新的版本。`)) return
    setSaving(true)
    setError("")
    try {
      const { data } = await api.post<Artifact>(`/artifacts/${artifact.id}/revert/${version.version}`)
      setArtifact(data)
      setContent(data.content)
      setTitle(data.title)
      setEditing(false)
      await loadVersions()
    } catch (reason) {
      setError(apiErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function optimize() {
    if (!artifact || !instruction.trim() || optimizing) return
    setOptimizing(true)
    setError("")
    setEditing(true)
    setContent("")
    try {
      const session = getSession()
      const response = await fetch(`/api/artifacts/${artifact.id}/optimize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.accessToken && session.accessToken !== "demo"
            ? { Authorization: `Bearer ${session.accessToken}` }
            : {}),
        },
        body: JSON.stringify({ instruction: instruction.trim() }),
      })
      if (!response.ok || !response.body) {
        throw new Error(`优化请求失败（${response.status}）`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""
        for (const event of events) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data: "))
          if (!dataLine) continue
          const payload = JSON.parse(dataLine.slice(6)) as { type?: string; content?: string; message?: string }
          if (payload.type === "markdown" && payload.content) {
            setContent((current) => current + payload.content)
          }
          if (payload.type === "error") {
            throw new Error(payload.message || "报告优化失败")
          }
        }
        if (done) break
      }
      setInstruction("")
      await loadArtifact()
    } catch (reason) {
      setError(apiErrorMessage(reason))
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-xl border-border bg-background p-0 text-foreground shadow-2xl">
        <DrawerHeader className="border-border pr-14">
          <DrawerTitle className="text-foreground">分析报告</DrawerTitle>
          <DrawerDescription className="text-muted-foreground">
            保存编辑会创建新版本，历史报告可随时恢复。
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && <p className="mb-4 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {!artifact ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
              <FileText className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">当前会话还没有分析报告</p>
              <p className="max-w-sm text-sm text-muted-foreground">完成一次需求分析后，报告会自动出现在这里。</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                <div className="min-w-0">
                  {editing ? (
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="w-full border-b border-input bg-transparent py-1 text-sm font-semibold outline-none focus:border-ring"
                      aria-label="报告标题"
                    />
                  ) : (
                    <p className="truncate text-sm font-semibold">{artifact.title}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">当前版本 v{artifact.currentVersion}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setEditing((current) => !current)}
                    disabled={optimizing}
                    aria-label={editing ? "查看报告" : "编辑报告"}
                    title={editing ? "查看报告" : "编辑报告"}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setVersionsOpen((current) => !current)
                      if (!versionsOpen) void loadVersions()
                    }}
                    aria-label="查看版本历史"
                    title="版本历史"
                  >
                    <History className="size-4" />
                  </Button>
                </div>
              </div>

              {versionsOpen && (
                <div className="space-y-2 border-b border-border pb-4">
                  <p className="text-xs font-medium text-muted-foreground">版本历史</p>
                  {sortedVersions.map((version) => (
                    <div key={version.id} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">v{version.version}{version.version === artifact.currentVersion ? "（当前）" : ""}</p>
                        <p className="truncate text-xs text-muted-foreground">{version.changelog || version.sourceTags.join(" / ")}</p>
                      </div>
                      {version.version !== artifact.currentVersion && (
                        <Button type="button" size="sm" variant="outline" onClick={() => void revert(version)} disabled={saving || optimizing}>
                          <RotateCcw className="size-3.5" />恢复
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {editing ? (
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={22}
                  className="min-h-[420px] border-border bg-card font-mono leading-6 text-foreground focus:border-ring focus:ring-ring/20"
                  aria-label="报告内容"
                  disabled={optimizing}
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words border border-border bg-card p-4 font-sans text-sm leading-7 text-foreground">{content}</pre>
              )}

              <div className="border-t border-border pt-4">
                <label htmlFor="artifact-optimize-instruction" className="text-sm font-medium">AI 优化</label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="artifact-optimize-instruction"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder="例如：补充验收标准和风险缓解措施"
                    className="h-9 min-w-0 flex-1 border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
                    disabled={optimizing}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => void optimize()} disabled={!instruction.trim() || optimizing}>
                    {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}优化
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {artifact && (
          <DrawerFooter className="border-border bg-background">
            {dirty && <span className="mr-auto text-xs text-muted-foreground">有未保存的修改</span>}
            <Button type="button" onClick={() => void save()} disabled={!dirty || saving || optimizing}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存版本
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
