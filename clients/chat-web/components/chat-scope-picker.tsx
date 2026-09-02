"use client"

import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Check, Filter, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatScope, KnowledgeDoc } from "@/lib/knowledge-data"

export type ScopeOption = { id: string; name: string }

type ChatScopePickerProps = {
  scope: ChatScope
  onChange: (scope: ChatScope) => void
  /** 可选文档列表，来自外层统一维护的知识库数据。 */
  documents: KnowledgeDoc[]
  /** 分类选项：内置分类 + 用户自建分类。 */
  categoryOptions: ScopeOption[]
  disabled?: boolean
}

/** 生成范围摘要文案，用于输入框内的触发按钮与无障碍标签。 */
export function describeScope(
  scope: ChatScope,
  documents: KnowledgeDoc[],
  categoryOptions: ScopeOption[],
): string {
  if (scope.mode === "category") {
    return categoryOptions.find((option) => option.id === scope.value)?.name ?? "指定分类"
  }
  if (scope.mode === "documents") {
    return scope.ids.length === 0 ? "未选择文档" : `${scope.ids.length} 篇文档`
  }
  return "全部文档"
}

export function ChatScopePicker({
  scope,
  onChange,
  documents,
  categoryOptions,
  disabled = false,
}: ChatScopePickerProps) {
  const selectedIds = scope.mode === "documents" ? scope.ids : []

  function toggleDocument(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id]
    onChange({ mode: "documents", ids: next })
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="设置本次对话的检索范围"
          aria-label="设置检索范围"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors",
            scope.mode === "all"
              ? "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              : "border-primary/30 bg-primary/10 text-primary",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <Filter className="size-3.5" />
          <span className="max-w-[7.5rem] truncate">
            {describeScope(scope, documents, categoryOptions)}
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={8}
          className="z-50 w-64 rounded-xl border border-border bg-card p-1.5 text-foreground shadow-lg shadow-black/5 animate-[message-in_0.15s_ease_both]"
        >
          <DropdownMenu.Item
            onSelect={() => onChange({ mode: "all" })}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none data-[highlighted]:bg-muted"
          >
            <Check className={cn("size-3.5", scope.mode !== "all" && "invisible")} />
            全部文档
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Label className="px-2.5 py-1 text-[0.6875rem] font-medium text-muted-foreground">
            按分类检索
          </DropdownMenu.Label>
          {categoryOptions.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              onSelect={() => onChange({ mode: "category", value: option.id })}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none data-[highlighted]:bg-muted"
            >
              <Check
                className={cn(
                  "size-3.5",
                  !(scope.mode === "category" && scope.value === option.id) && "invisible",
                )}
              />
              <span className="truncate">{option.name}</span>
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-[0.6875rem] font-medium text-muted-foreground">
              指定文档
            </span>
            {scope.mode === "documents" && selectedIds.length > 0 && (
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onChange({ mode: "documents", ids: [] })
                }}
                className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />清空
              </button>
            )}
          </div>

          <div className="pretty-scroll max-h-56 overflow-y-auto">
            {documents.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">暂无可检索文档</p>
            ) : (
              documents.map((document) => {
                const checked = selectedIds.includes(document.id)
                return (
                  <DropdownMenu.CheckboxItem
                    key={document.id}
                    checked={checked}
                    // 多选需要保持菜单打开，否则每点一次都要重新展开。
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleDocument(document.id)}
                    className="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs outline-none data-[highlighted]:bg-muted"
                  >
                    <Check className={cn("mt-0.5 size-3.5 shrink-0", !checked && "invisible")} />
                    <span className="line-clamp-2 min-w-0 break-all">{document.title}</span>
                  </DropdownMenu.CheckboxItem>
                )
              })
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
