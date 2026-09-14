"use client"

import { useMemo, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { apiErrorMessage } from "@/lib/api"
import { MAX_CATEGORY_NAME_LENGTH } from "@/lib/categories"
import type { Category } from "@/lib/knowledge-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import {
  CloudLightning,
  FolderClosed,
  Loader2,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"

type View = "documents" | "chat"

/** 向量片段软上限，仅用于侧栏配额条的占比展示，不是服务端的硬性限制。 */
const VECTOR_QUOTA_CAP = 2000

export type SidebarConversation = {
  id: string
  title: string
  createdAt?: string
  updatedAt?: string
  pinned?: boolean
}

type SidebarProps = {
  view: View
  onViewChange: (view: View) => void
  activeCategory: string
  onCategoryChange: (id: string) => void
  categories: Category[]
  userName: string
  userEmail: string
  onNewConversation: () => void
  conversations?: SidebarConversation[]
  activeConversationId?: string | null
  onSelectConversation?: (id: string) => void
  onPinConversation?: (id: string) => Promise<void> | void
  onRenameConversation?: (id: string, title: string) => Promise<void> | void
  onDeleteConversation?: (id: string) => Promise<void> | void
  onLogout: () => void
  /** 文档总数与向量片段总数，用于侧栏底部的配额条。 */
  documentCount?: number
  chunkCount?: number
  /** 自定义分类的增删入口；演示身份或未登录态不传，此时分类区只读。 */
  onCreateCategory?: (name: string) => Promise<void>
  onDeleteCategory?: (id: string) => Promise<void>
}

export function Sidebar({
  view,
  onViewChange,
  activeCategory,
  onCategoryChange,
  categories,
  userName,
  userEmail,
  onNewConversation,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onPinConversation,
  onRenameConversation,
  onDeleteConversation,
  onLogout,
  documentCount = 0,
  chunkCount = 0,
  onCreateCategory,
  onDeleteCategory,
}: SidebarProps) {
  const [conversationSearch, setConversationSearch] = useState("")
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const [conversationError, setConversationError] = useState("")
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null)
  const [conversationToDelete, setConversationToDelete] = useState<SidebarConversation | null>(null)
  const [conversationToRename, setConversationToRename] = useState<SidebarConversation | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameError, setRenameError] = useState("")
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [pinningConversationId, setPinningConversationId] = useState<string | null>(null)
  // 自定义分类：新建弹窗与删除确认弹窗的状态都收敛在侧栏内部，
  // 请求本身由上层注入，便于统一处理演示身份与错误提示。
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [categoryError, setCategoryError] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deleteCategoryError, setDeleteCategoryError] = useState("")
  const avatarText = (userName || userEmail || "C").trim().slice(0, 1).toUpperCase()
  const visibleConversations = useMemo(() => {
    const keyword = conversationSearch.trim().toLowerCase()
    const filtered = !keyword
      ? conversations
      : conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(keyword),
        )

    // 置顶会话固定排在列表顶部，同时保持服务端返回的时间顺序。
    // eslint-disable-next-line unicorn/no-array-sort -- 对副本排序，不会修改原数组
    return [...filtered].sort(
      (left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)),
    )
  }, [conversationSearch, conversations])

  async function handlePinConversation(conversation: SidebarConversation) {
    if (!onPinConversation || pinningConversationId) return
    setConversationError("")
    setPinningConversationId(conversation.id)
    try {
      await onPinConversation(conversation.id)
    } catch (reason) {
      setConversationError(apiErrorMessage(reason))
    } finally {
      setPinningConversationId(null)
    }
  }

  function openRenameDialog(conversation: SidebarConversation) {
    setConversationError("")
    setRenameError("")
    setRenameValue(conversation.title || "")
    setConversationToRename(conversation)
  }

  function closeConversationMenuThen(run: () => void) {
    setOpenConversationMenuId(null)
    // DropdownMenu 会在当前选择事件结束后恢复焦点。等菜单完全关闭后再打开
    // Dialog，避免关闭菜单的焦点恢复事件立即把确认框当作“外部点击”而关闭。
    window.requestAnimationFrame(run)
  }

  return (
    <>
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/20">
          <CloudLightning className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">CloudSage</span>
          <span className="text-xs text-muted-foreground">AI 知识库</span>
        </div>
      </div>

      <div className="px-3">
        <Button
          size="lg"
          className="w-full justify-start gap-2"
          onClick={onNewConversation}
          disabled={view === "chat" && conversations.length === 0}
          title={view === "chat" && conversations.length === 0 ? "发送第一条消息后才能新建对话" : undefined}
        >
          <Sparkles className="size-4" />
          {view === "chat" ? "新建对话" : "向 AI 提问"}
          {view === "chat" && <Plus className="ml-auto size-4 opacity-80" />}
        </Button>
      </div>

      <nav className="mt-5 flex flex-col gap-1 px-3">
        <NavItem
          icon={<FolderClosed className="size-4" />}
          label="文档库"
          active={view === "documents"}
          onClick={() => onViewChange("documents")}
        />
        <NavItem
          icon={<MessagesSquare className="size-4" />}
          label="AI 对话"
          active={view === "chat"}
          onClick={() => onViewChange("chat")}
        />
      </nav>

      {view === "documents" ? (
        <>
          <div className="mt-6 flex items-center justify-between px-5 py-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground">分类</span>
            {onCreateCategory && (
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="新建分类"
                title="新建自定义分类"
                onClick={() => {
                  setCategoryError("")
                  setNewCategoryName("")
                  setCategoryDialogOpen(true)
                }}
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>

          <div className="pretty-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
            {categories.map((cat) => {
              const itemClass = cn(
                "flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors",
                view === "documents" && activeCategory === cat.id
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
              )
              const body = (
                <>
                  <span className="truncate">{cat.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{cat.count}</span>
                </>
              )

              // 只有用户自建的分类允许删除；内置分类始终保留。
              if (!cat.custom || !onDeleteCategory) {
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onCategoryChange(cat.id)
                      onViewChange("documents")
                    }}
                    className={itemClass}
                  >
                    {body}
                  </button>
                )
              }

              return (
                <div key={cat.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onCategoryChange(cat.id)
                      onViewChange("documents")
                    }}
                    className={cn(itemClass, "w-full pr-9")}
                  >
                    {body}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除分类 ${cat.name}`}
                    title="删除分类"
                    disabled={Boolean(deletingCategoryId)}
                    onClick={() => {
                      setDeleteCategoryError("")
                      setCategoryToDelete(cat)
                    }}
                    className="absolute right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 disabled:cursor-wait"
                  >
                    {deletingCategoryId === cat.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-6">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground">聊天记录</span>
            {conversations.length > 0 && <Search className="size-3.5 text-muted-foreground" />}
          </div>
          {conversations.length > 4 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
                placeholder="搜索会话"
                className="h-8 w-full rounded-lg border border-sidebar-border bg-sidebar-accent/30 pl-8 pr-2 text-xs text-sidebar-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
          )}
          <div className="pretty-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
            {conversationError && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                {conversationError}
              </p>
            )}
            {visibleConversations.length === 0 ? (
              <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                暂无聊天记录，发送消息后会自动创建新对话
              </p>
            ) : (
              visibleConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    "group relative flex w-full min-w-0 items-center gap-1 rounded-lg text-left text-xs transition-colors",
                    conversation.id === activeConversationId
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                  )}
                >
                  {conversation.id === activeConversationId && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary" />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectConversation?.(conversation.id)}
                    title={conversation.title}
                    aria-current={conversation.id === activeConversationId ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {conversation.pinned ? (
                      <Pin className="size-3.5 shrink-0 text-sidebar-primary" />
                    ) : (
                      <MessagesSquare className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{conversation.title || "新会话"}</span>
                  </button>
                  {(onPinConversation || onRenameConversation || onDeleteConversation) && (
                    <DropdownMenuPrimitive.Root
                      open={openConversationMenuId === conversation.id}
                      onOpenChange={(open) => {
                        setOpenConversationMenuId(open ? conversation.id : null)
                      }}
                    >
                      <DropdownMenuPrimitive.Trigger asChild>
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          disabled={Boolean(deletingConversationId) || Boolean(pinningConversationId)}
                          aria-label={`管理会话${conversation.title || "新会话"}`}
                          title="会话操作"
                          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          {pinningConversationId === conversation.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-3.5" />
                          )}
                        </button>
                      </DropdownMenuPrimitive.Trigger>
                      <DropdownMenuPrimitive.Portal>
                        <DropdownMenuPrimitive.Content
                          align="end"
                          sideOffset={4}
                          className="z-50 min-w-36 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                        >
                          {onPinConversation && (
                            <DropdownMenuPrimitive.Item
                              disabled={Boolean(pinningConversationId)}
                              onSelect={() => void handlePinConversation(conversation)}
                              className="flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                            >
                              {conversation.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                              {conversation.pinned ? "取消置顶" : "置顶"}
                            </DropdownMenuPrimitive.Item>
                          )}
                          {onRenameConversation && (
                            <DropdownMenuPrimitive.Item
                              onSelect={(event) => {
                                event.preventDefault()
                                closeConversationMenuThen(() => openRenameDialog(conversation))
                              }}
                              className="flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                            >
                              <Pencil className="size-3.5" />
                              重命名
                            </DropdownMenuPrimitive.Item>
                          )}
                          {onDeleteConversation && (
                            <>
                              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
                              <DropdownMenuPrimitive.Item
                                disabled={Boolean(deletingConversationId)}
                                onSelect={(event) => {
                                  if (deletingConversationId) return
                                  event.preventDefault()
                                  setConversationError("")
                                  closeConversationMenuThen(() => setConversationToDelete(conversation))
                                }}
                                className="flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs text-destructive outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                                删除
                              </DropdownMenuPrimitive.Item>
                            </>
                          )}
                        </DropdownMenuPrimitive.Content>
                      </DropdownMenuPrimitive.Portal>
                    </DropdownMenuPrimitive.Root>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 向量索引配额：片段数相对软上限的占用比例 */}
      <div className="border-t border-sidebar-border px-3 py-2.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>向量索引</span>
          <span>{chunkCount} 片段</span>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label="向量索引占用"
          aria-valuenow={chunkCount}
          aria-valuemin={0}
          aria-valuemax={VECTOR_QUOTA_CAP}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{
              width: `${Math.min(100, (chunkCount / VECTOR_QUOTA_CAP) * 100)}%`,
            }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {documentCount} 篇文档已入库
        </p>
      </div>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
            {avatarText}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight" title={`${userName}\n${userEmail}`}>
            <span className="truncate whitespace-nowrap text-sm font-medium text-sidebar-foreground">
              {userName || userEmail}
            </span>
            <span className="truncate whitespace-nowrap text-xs text-muted-foreground">
              {userEmail}
            </span>
          </div>
          <ThemeToggle className="h-7 w-7 shrink-0 border-transparent bg-transparent" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onLogout}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
      </aside>

      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingConversationId) {
            setConversationToDelete(null)
            setConversationError("")
          }
        }}
        title="删除会话"
        description={
          <>
            确定要删除“{conversationToDelete?.title || "新会话"}”吗？
            <br />
            会话中的消息也会一并删除，此操作无法撤销。
          </>
        }
        confirmText="删除会话"
        loading={Boolean(deletingConversationId)}
        error={conversationError}
        onConfirm={async () => {
          const target = conversationToDelete
          if (!target || !onDeleteConversation || deletingConversationId) return
          setConversationError("")
          setDeletingConversationId(target.id)
          // 确认框此时已关闭，这里只等待后端删除请求。
          // 删除接口或数据库发生延迟时，用户仍然可以操作其他区域；
          // 失败信息会显示在左侧会话列表上方，避免页面被 Dialog 锁死。
          try {
            await onDeleteConversation(target.id)
          } catch (reason) {
            setConversationError(apiErrorMessage(reason))
          } finally {
            setDeletingConversationId(null)
          }
        }}
      />

      <DialogPrimitive.Root
        open={Boolean(conversationToRename)}
        onOpenChange={(open) => {
          if (!open && !renamingConversationId) {
            setConversationToRename(null)
            setRenameError("")
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl outline-none">
            <div className="p-5">
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                重命名会话
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                为这个会话设置一个容易识别的名称。
              </DialogPrimitive.Description>
              <Input
                autoFocus
                value={renameValue}
                maxLength={80}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void saveRename()
                  }
                }}
                placeholder="输入会话名称"
                className="mt-4"
              />
              {renameError && (
                <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                  {renameError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(renamingConversationId)}
                onClick={() => setConversationToRename(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(renamingConversationId) || !conversationToRename || !onRenameConversation}
                onClick={() => void saveRename()}
              >
                {renamingConversationId ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
                {renamingConversationId ? "保存中…" : "保存"}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          if (!open && !creatingCategory) {
            setCategoryDialogOpen(false)
            setCategoryError("")
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl outline-none">
            <div className="p-5">
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                新建分类
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-sm leading-6 text-muted-foreground">
                自定义分类会出现在侧栏与文档筛选条中，上传文档时可以直接归类到它。
              </DialogPrimitive.Description>
              <Input
                autoFocus
                value={newCategoryName}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submitCategory()
                  }
                }}
                placeholder="例如：客户合同"
                className="mt-4"
              />
              {categoryError && (
                <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                  {categoryError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={creatingCategory}
                onClick={() => setCategoryDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={creatingCategory || !newCategoryName.trim()}
                onClick={() => void submitCategory()}
              >
                {creatingCategory ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                {creatingCategory ? "创建中…" : "创建分类"}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ConfirmDialog
        open={Boolean(categoryToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingCategoryId) {
            setCategoryToDelete(null)
            setDeleteCategoryError("")
          }
        }}
        title="删除分类"
        description={
          <>
            确定要删除“{categoryToDelete?.name}”吗？
            <br />
            {categoryToDelete && categoryToDelete.count > 0
              ? `该分类下的 ${categoryToDelete.count} 篇文档会移动到「产品文档」，文档本身不会被删除。`
              : "该分类下暂无文档，删除后可在需要时重新创建。"}
          </>
        }
        confirmText="删除分类"
        loading={Boolean(deletingCategoryId)}
        error={deleteCategoryError}
        onConfirm={confirmDeleteCategory}
      />
    </>
  )

  async function submitCategory() {
    if (!onCreateCategory || creatingCategory) return
    const name = newCategoryName.trim()
    if (!name) {
      setCategoryError("分类名称不能为空")
      return
    }

    setCategoryError("")
    setCreatingCategory(true)
    try {
      await onCreateCategory(name)
      setCategoryDialogOpen(false)
      setNewCategoryName("")
    } catch (reason) {
      setCategoryError(apiErrorMessage(reason))
    } finally {
      setCreatingCategory(false)
    }
  }

  async function confirmDeleteCategory() {
    if (!onDeleteCategory || !categoryToDelete || deletingCategoryId) return
    const target = categoryToDelete
    setDeleteCategoryError("")
    setDeletingCategoryId(target.id)
    try {
      await onDeleteCategory(target.id)
      setCategoryToDelete(null)
    } catch (reason) {
      setDeleteCategoryError(apiErrorMessage(reason))
    } finally {
      setDeletingCategoryId(null)
    }
  }

  async function saveRename() {
    if (!conversationToRename || !onRenameConversation || renamingConversationId) return
    const title = renameValue.trim()
    if (!title) {
      setRenameError("会话名称不能为空")
      return
    }

    setRenameError("")
    setRenamingConversationId(conversationToRename.id)
    try {
      await onRenameConversation(conversationToRename.id, title)
      setConversationToRename(null)
    } catch (reason) {
      setRenameError(apiErrorMessage(reason))
    } finally {
      setRenamingConversationId(null)
    }
  }
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary" />
      )}
      {icon}
      {label}
    </button>
  )
}
