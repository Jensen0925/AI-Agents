"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AlertTriangle, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * 紧凑确认框：对齐 WorkBuddy 的删除确认样式。
 *
 * 与浏览器原生 confirm 的关键差异：点确认后会**先关闭遮罩再发请求**，
 * 因此后端延迟或失败时页面不会被锁死，错误可以在触发位置就近展示。
 */
type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」。 */
  cancelText?: string
  /** destructive = 红色实心（删除类）；primary = 主色实心（覆盖/恢复类）。 */
  tone?: "destructive" | "primary"
  /** 标题左侧图标，默认警示三角；传 null 可关闭图标。 */
  icon?: React.ReactNode | null
  /** 确认进行中：按钮转圈并禁用。 */
  loading?: boolean
  /** 请求失败信息，展示在正文下方。 */
  error?: string
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  tone = "destructive",
  icon,
  loading = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl outline-none">
          <div className="p-5">
            <div className="flex items-start gap-3">
              {icon !== null && (
                <div
                  className={
                    tone === "destructive"
                      ? "flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
                      : "flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                  }
                >
                  {icon ?? <AlertTriangle className="size-5" />}
                </div>
              )}
              <div className="min-w-0 pt-0.5">
                <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => onOpenChange(false)}
            >
              {cancelText}
            </Button>
            <Button
              type="button"
              variant={tone === "destructive" ? "destructive" : "default"}
              size="sm"
              disabled={loading}
              onClick={() => {
                // 先关遮罩再执行，避免请求耗时期间整个页面不可操作。
                onOpenChange(false)
                void onConfirm()
              }}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : tone === "destructive" ? (
                <Trash2 className="size-3.5" />
              ) : null}
              {loading ? "处理中…" : confirmText}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
