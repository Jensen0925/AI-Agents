"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Clock3,
  FileText,
  FolderOpen,
  Grid2X2,
  Layers3,
  List,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import {
  clearSession,
  getCurrentUser,
  isDemoSession,
  type SessionUser,
} from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";

interface DocumentItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  chunkCount: number;
  createdAt: string;
  filePath?: string | null;
}

export interface DocumentCategory {
  id: "all" | "product" | "engineering" | "hr" | "sales" | "design";
  name: string;
  count: number;
}

const CATEGORY_NAMES: Array<Omit<DocumentCategory, "count">> = [
  { id: "all", name: "全部文档" },
  { id: "product", name: "产品文档" },
  { id: "engineering", name: "技术规范" },
  { id: "hr", name: "人事制度" },
  { id: "sales", name: "销售手册" },
  { id: "design", name: "设计指南" },
];

export interface TaskEvent {
  id: string;
  taskType: string;
  taskId: string;
  status: "pending" | "processing" | "done" | "error";
  message?: string | null;
  metadata?: { filename?: string; chunkCount?: number } | null;
  createdAt: string;
  readAt?: string | null;
}

export interface SidebarConversation {
  id: string;
  title: string;
  updatedAt: string;
}

const DEMO_DOCUMENTS: DocumentItem[] = [
  {
    id: "doc-demo-1",
    filename: "电商退款政策.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 16896,
    status: "done",
    chunkCount: 3,
    createdAt: "2026-04-11T08:00:00.000Z",
  },
];

export const DEMO_EVENTS: TaskEvent[] = [
  {
    id: "event-1",
    taskType: "document_processing",
    taskId: "doc-demo-1",
    status: "done",
    message: "向量化完成，共 3 个 chunk",
    metadata: { filename: "电商退款政策.docx", chunkCount: 3 },
    createdAt: "2026-08-02T12:00:00.000Z",
    readAt: null,
  },
  {
    id: "event-2",
    taskType: "document_processing",
    taskId: "doc-demo-1",
    status: "processing",
    message: "开始向量化电商退款政策.docx",
    metadata: { filename: "电商退款政策.docx" },
    createdAt: "2026-08-01T09:00:00.000Z",
    readAt: "2026-08-01T10:00:00.000Z",
  },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function formatRelative(value: string) {
  const minutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function fileKind(mimeType: string) {
  if (mimeType.includes("word") || mimeType.includes("doc")) return "DOCX";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("markdown")) return "MD";
  return "TXT";
}

function inferCategory(filename: string): DocumentCategory["id"] {
  const normalized = filename.toLowerCase();
  if (/设计|ui|ux|视觉|组件|样式|交互/.test(normalized)) return "design";
  if (/员工|人事|考勤|绩效|福利|招聘|薪酬/.test(normalized)) return "hr";
  if (/销售|市场|客户|报价|商务|营销/.test(normalized)) return "sales";
  if (/技术|架构|api|接口|开发|数据库|安全|部署|运维|代码|规范/.test(normalized)) {
    return "engineering";
  }
  return "product";
}

function documentSummary(document: DocumentItem) {
  if (document.status === "done") {
    return `该文档已由 CloudSage 解析为 ${document.chunkCount} 个知识片段，可用于语义检索与 AI 问答。`;
  }
  if (document.status === "processing") return "CloudSage 正在解析文档内容并构建向量索引。";
  if (document.status === "error") return "文档处理失败，可重新触发解析与向量化。";
  return "文档已上传，等待解析、分块和向量化处理。";
}

function statusLabel(status: string) {
  if (status === "done") return "已完成";
  if (status === "processing") return "处理中";
  if (status === "error") return "处理失败";
  return "待处理";
}

function isLocalPreview() {
  return isDemoSession() || !getCurrentUser();
}

interface SidebarProps {
  mobile?: boolean;
  compact?: boolean;
  chatMode?: boolean;
  active?: "library" | "conversation";
  onClose?: () => void;
  onNew: () => void;
  onOpenNotifications?: () => void;
  notificationUnread?: boolean;
  recentConversations?: SidebarConversation[];
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  documentCategories?: DocumentCategory[];
  activeDocumentCategory?: string;
  onDocumentCategoryChange?: (id: DocumentCategory["id"]) => void;
}

export function DarkSidebar({
  mobile = false,
  active = "library",
  onClose,
  onNew,
  onOpenNotifications,
  notificationUnread = false,
  recentConversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  documentCategories = [],
  activeDocumentCategory = "all",
  onDocumentCategoryChange,
}: SidebarProps) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const accountTooltipId = useId();

  useEffect(() => setUser(getCurrentUser()), []);

  const visibleConversations = useMemo(() => {
    const keyword = conversationSearch.trim().toLowerCase();
    if (!keyword) return recentConversations;
    return recentConversations.filter((item) =>
      item.title.toLowerCase().includes(keyword),
    );
  }, [conversationSearch, recentConversations]);

  function logout() {
    clearSession();
    router.replace("/login");
  }

  const account = user?.email || user?.name || "cookieboty";

  return (
    <aside
      className={cn(
        "flex h-full w-[256px] shrink-0 flex-col border-r border-white/[0.08] bg-[#111118] text-[#e5e5e5]",
        mobile && "w-[280px]",
      )}
    >
      <div className="flex h-[72px] items-center justify-between px-5">
        <Link href="/chat" className="flex min-w-0 items-center gap-3" onClick={onClose}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1e40af] text-sm font-bold text-white shadow-[0_8px_24px_rgba(30,64,175,0.28)]">
            C
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-tight">CloudSage</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-[#747c84]">
              AI 知识库
            </span>
          </span>
        </Link>
        {mobile && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#777783] hover:bg-white/[0.06] hover:text-white"
            aria-label="关闭导航"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 pb-3">
        <Button
          type="button"
          onClick={onNew}
          className="h-10 w-full justify-start rounded-xl bg-[#1e40af] px-3.5 text-sm text-white shadow-none hover:bg-[#1d4ed8]"
        >
          <Sparkles className="h-4 w-4" />
          向 AI 提问
          <Plus className="ml-auto h-4 w-4 opacity-80" />
        </Button>
      </div>

      <nav className="space-y-1 px-3" aria-label="主导航">
        <Link
          href="/knowledge-base"
          onClick={onClose}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
            active === "library"
              ? "bg-white/[0.08] font-medium text-white"
              : "text-[#9ca3af] hover:bg-white/[0.05] hover:text-white",
          )}
        >
          <FolderOpen className="h-4 w-4" />
          文档库
        </Link>
        <Link
          href="/chat"
          onClick={onClose}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
            active === "conversation"
              ? "bg-white/[0.08] font-medium text-white"
              : "text-[#9ca3af] hover:bg-white/[0.05] hover:text-white",
          )}
        >
          <MessageSquare className="h-4 w-4" />
          AI 对话
        </Link>
      </nav>

      <div className="mx-5 my-4 h-px bg-white/[0.07]" />

      {active === "library" ? (
        <div className="flex min-h-0 flex-1 flex-col px-3">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#666672]">
              分类
            </span>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#666672] hover:bg-white/[0.06] hover:text-white"
              aria-label="新建分类"
              title="分类由文档名称自动识别"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3">
            {documentCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => onDocumentCategoryChange?.(category.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                  activeDocumentCategory === category.id
                    ? "bg-white/[0.08] font-medium text-white"
                    : "text-[#9ca3af] hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <span className="truncate">{category.name}</span>
                <span className="ml-2 shrink-0 text-xs text-[#666672]">{category.count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#666672]">
              最近会话
            </span>
            <Search className="h-3.5 w-3.5 text-[#555562]" />
          </div>
          {recentConversations.length > 4 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#555562]" />
              <input
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
                placeholder="搜索会话"
                className="h-8 w-full rounded-lg border border-white/[0.07] bg-white/[0.025] pl-8 pr-2 text-xs text-[#d7d7df] outline-none placeholder:text-[#555562] focus:border-blue-400/40"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
            {visibleConversations.length === 0 ? (
              <button
                type="button"
                onClick={onNew}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[#777783] hover:bg-white/[0.04] hover:text-[#c9c9d2]"
              >
                <Plus className="h-3.5 w-3.5" />
                新建第一个会话
              </button>
            ) : (
              visibleConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    "group flex items-center rounded-lg transition-colors",
                    conversation.id === activeConversationId
                      ? "bg-blue-500/10 text-blue-200"
                      : "text-[#8f8f9b] hover:bg-white/[0.04] hover:text-[#d7d7df]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation?.(conversation.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs"
                    title={conversation.title}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{conversation.title}</span>
                  </button>
                  {onDeleteConversation && (
                    <button
                      type="button"
                      onClick={() => onDeleteConversation(conversation.id)}
                      className="mr-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#666672] hover:bg-red-500/10 hover:text-red-300 group-hover:flex"
                      aria-label={`删除会话 ${conversation.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="border-t border-white/[0.08] p-3">
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.025] p-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-xs font-semibold text-blue-200">
            {(user?.name || account).slice(0, 1).toUpperCase()}
          </span>
          <div className="group relative min-w-0 flex-1">
            <p
              className="truncate whitespace-nowrap text-xs font-medium text-[#d7d7df]"
              aria-describedby={accountTooltipId}
              tabIndex={0}
            >
              {account}
            </p>
            <p className="truncate whitespace-nowrap text-[10px] text-[#666672]">
              {isDemoSession() ? "演示工作区" : "CloudSage Workspace"}
            </p>
            <span
              id={accountTooltipId}
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden max-w-[220px] break-all rounded-md border border-white/[0.1] bg-[#1a1a24] px-2.5 py-1.5 text-[11px] text-[#e5e5e5] shadow-xl group-hover:block group-focus-within:block"
            >
              {account}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#777783] hover:bg-white/[0.08] hover:text-white"
            aria-label="通知中心"
            title="通知中心"
          >
            <Bell className="h-4 w-4" />
            {notificationUnread && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
          <ThemeToggle className="h-8 w-8 shrink-0 border-0 bg-transparent" />
          <button
            type="button"
            onClick={logout}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#777783] hover:bg-red-500/10 hover:text-red-300"
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function NotificationCenter({
  events,
  onRead,
  onClose,
}: {
  events: TaskEvent[];
  onRead: (event: TaskEvent) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const visibleEvents = tab === "unread" ? events.filter((event) => !event.readAt) : events;

  return (
    <aside className="flex h-full w-[344px] shrink-0 flex-col border-l border-white/[0.08] bg-[#111118]">
      <div className="flex h-[72px] items-center justify-between border-b border-white/[0.08] px-5">
        <div>
          <h2 className="text-sm font-semibold text-[#e5e5e5]">通知中心</h2>
          <p className="mt-1 text-[11px] text-[#666672]">文档处理与向量化进度</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#777783] hover:bg-white/[0.06] hover:text-white"
          aria-label="关闭通知中心"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex h-11 items-end gap-5 border-b border-white/[0.08] px-5">
        {(["all", "unread"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "relative h-11 text-xs transition-colors",
              tab === value ? "font-medium text-white" : "text-[#777783] hover:text-[#c9c9d2]",
            )}
          >
            {value === "all" ? "全部" : `未读 ${events.filter((event) => !event.readAt).length}`}
            {tab === value && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1e40af]" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visibleEvents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-[#666672]">
              <Bell className="h-5 w-5" />
            </span>
            <p className="mt-4 text-sm font-medium text-[#c9c9d2]">暂无通知</p>
            <p className="mt-1 text-xs leading-5 text-[#666672]">文档处理状态会实时显示在这里</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onRead(event)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors",
                  event.readAt
                    ? "border-transparent bg-transparent hover:bg-white/[0.035]"
                    : "border-blue-400/10 bg-blue-500/[0.07] hover:bg-blue-500/10",
                )}
              >
                <div className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-blue-300">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-5 text-[#d7d7df]">
                        {event.message || statusLabel(event.status)}
                      </p>
                      {!event.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[#666672]">
                      {event.metadata?.filename || "知识库任务"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[9px] font-medium",
                          event.status === "done"
                            ? "bg-emerald-400/10 text-emerald-400"
                            : event.status === "error"
                              ? "bg-red-400/10 text-red-300"
                              : "bg-amber-400/10 text-amber-300",
                        )}
                      >
                        {statusLabel(event.status)}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[#555562]">
                        <Clock3 className="h-3 w-3" />
                        {formatRelative(event.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-white/[0.08] p-4 text-center">
        <span className="text-xs text-[#777783]">已展示最近的任务通知</span>
      </div>
    </aside>
  );
}

function DocumentCard({
  document,
  onDelete,
  onProcess,
}: {
  document: DocumentItem;
  onDelete: (document: DocumentItem) => void;
  onProcess: (document: DocumentItem) => void;
}) {
  const tags = [fileKind(document.mimeType), statusLabel(document.status), `${document.chunkCount} chunks`];

  return (
    <article className="group flex min-h-[270px] cursor-pointer flex-col rounded-2xl border border-white/[0.08] bg-[#16161f] p-5 transition-all hover:border-blue-400/35 hover:shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
          <FileText className="h-5 w-5" />
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-medium",
            document.status === "done"
              ? "bg-emerald-400/10 text-emerald-400"
              : document.status === "error"
                ? "bg-red-400/10 text-red-300"
                : "bg-amber-400/10 text-amber-300",
          )}
        >
          {statusLabel(document.status)}
        </span>
      </div>
      <div className="mt-4 min-w-0 flex-1">
        <h3
          className="truncate text-sm font-semibold leading-snug text-[#e5e5e5] transition-colors group-hover:text-blue-300"
          title={document.filename}
        >
          {document.filename}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#777783]">
          {documentSummary(document)}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] text-[#9ca3af]">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3">
        <span className="text-[11px] text-[#666672]">
          {formatSize(document.size)} · {formatDate(document.createdAt)}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onProcess(document)}
            disabled={document.status === "processing"}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-[#9ca3af] transition-colors hover:bg-blue-500/10 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {document.status === "processing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers3 className="h-3.5 w-3.5" />
            )}
            {document.status === "done" ? "重新处理" : "开始处理"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(document)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#666672] transition-colors hover:bg-red-500/10 hover:text-red-300"
            aria-label={`删除 ${document.filename}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function DocumentRow({
  document,
  onDelete,
  onProcess,
}: {
  document: DocumentItem;
  onDelete: (document: DocumentItem) => void;
  onProcess: (document: DocumentItem) => void;
}) {
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-white/[0.08] bg-[#16161f] px-4 py-3 transition-all hover:border-blue-400/35 hover:shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[#e5e5e5] group-hover:text-blue-300">
            {document.filename}
          </h3>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              document.status === "done"
                ? "bg-emerald-400/10 text-emerald-400"
                : document.status === "error"
                  ? "bg-red-400/10 text-red-300"
                  : "bg-amber-400/10 text-amber-300",
            )}
          >
            {statusLabel(document.status)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#777783]">{documentSummary(document)}</p>
      </div>
      <div className="hidden shrink-0 items-center gap-6 text-xs text-[#666672] md:flex">
        <span className="w-14 text-right">{fileKind(document.mimeType)}</span>
        <span className="w-16 text-right">{formatSize(document.size)}</span>
        <span className="w-24 text-right">{formatDate(document.createdAt)}</span>
      </div>
      <button
        type="button"
        onClick={() => onProcess(document)}
        disabled={document.status === "processing"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#777783] hover:bg-blue-500/10 hover:text-blue-200 disabled:opacity-50"
        aria-label={`处理 ${document.filename}`}
      >
        {document.status === "processing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Layers3 className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={() => onDelete(document)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#666672] hover:bg-red-500/10 hover:text-red-300"
        aria-label={`删除 ${document.filename}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </article>
  );
}

export function KnowledgeBaseWorkspace() {
  const [hydrated, setHydrated] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<DocumentCategory["id"]>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNoticeOpen, setMobileNoticeOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = hydrated && isLocalPreview();
  const documentCategories = useMemo<DocumentCategory[]>(() => {
    const counts = new Map<DocumentCategory["id"], number>();
    for (const document of documents) {
      const category = inferCategory(document.filename);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return CATEGORY_NAMES.map((category) => ({
      ...category,
      count: category.id === "all" ? documents.length : counts.get(category.id) ?? 0,
    }));
  }, [documents]);

  const activeCategoryName =
    documentCategories.find((category) => category.id === activeCategory)?.name ?? "全部文档";

  const filteredDocuments = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesCategory = activeCategory === "all" || inferCategory(document.filename) === activeCategory;
      const matchesSearch = !keyword || document.filename.toLowerCase().includes(keyword);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, documents, search]);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      if (preview) {
        setDocuments(DEMO_DOCUMENTS);
        setEvents(DEMO_EVENTS);
        setLoading(false);
        return;
      }
      try {
        const [documentsResponse, eventsResponse] = await Promise.all([
          api.get<DocumentItem[]>("/documents"),
          api.get<{ items: TaskEvent[] }>("/tasks/history", { params: { pageSize: 20 } }),
        ]);
        if (!cancelled) {
          setDocuments(documentsResponse.data);
          setEvents(eventsResponse.data.items);
        }
      } catch (reason) {
        if (!cancelled) setError(apiErrorMessage(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [hydrated, preview]);

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (preview) {
      setError("演示模式不写入服务器，请使用真实账号登录后上传文档。");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("filename", file.name);
    setUploading(true);
    setError("");
    try {
      const { data } = await api.post<DocumentItem>("/documents/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDocuments((current) => [data, ...current]);
      await api.post(`/documents/${data.id}/process`);
      setDocuments((current) =>
        current.map((item) =>
          item.id === data.id ? { ...item, status: "processing" } : item,
        ),
      );
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setUploading(false);
    }
  }

  async function processDocument(document: DocumentItem) {
    if (preview) {
      setError("演示模式不会触发文档处理任务。");
      return;
    }
    try {
      await api.post(`/documents/${document.id}/process`);
      setDocuments((current) =>
        current.map((item) =>
          item.id === document.id ? { ...item, status: "processing" } : item,
        ),
      );
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }

  async function deleteDocument(document: DocumentItem) {
    if (!window.confirm(`确认删除“${document.filename}”？`)) return;
    try {
      if (!preview) await api.delete(`/documents/${document.id}`);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }

  async function markRead(event: TaskEvent) {
    if (event.readAt) return;
    try {
      if (!preview) await api.patch(`/tasks/${event.taskId}/read`);
      setEvents((current) =>
        current.map((item) =>
          item.id === event.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }

  const sidebar = (
    <DarkSidebar
      mobile={mobileNavOpen}
      active="library"
      onNew={() => routerPush("/chat")}
      onClose={() => setMobileNavOpen(false)}
      onOpenNotifications={() => {
        if (window.matchMedia("(min-width: 1280px)").matches) setNoticeVisible(true);
        else setMobileNoticeOpen(true);
      }}
      notificationUnread={events.some((event) => !event.readAt)}
      documentCategories={documentCategories}
      activeDocumentCategory={activeCategory}
      onDocumentCategoryChange={(category) => {
        setActiveCategory(category);
        setMobileNavOpen(false);
      }}
    />
  );

  function routerPush(path: string) {
    window.location.assign(path);
  }

  return (
    <div className="flex h-screen min-h-[620px] overflow-hidden bg-[#0a0a0f] text-[#e5e5e5]">
      <div className="hidden h-full shrink-0 lg:flex">{sidebar}</div>
      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerContent className="max-w-[280px] border-white/[0.08] bg-[#111118] p-0 text-[#e5e5e5]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>主导航</DrawerTitle>
            <DrawerDescription>CloudSage 知识库导航</DrawerDescription>
          </DrawerHeader>
          {sidebar}
        </DrawerContent>
      </Drawer>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/[0.08] px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-[#9ca3af] hover:bg-white/[0.08] hover:text-white lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开导航"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-base font-semibold text-[#e5e5e5]">{activeCategoryName}</h1>
              <p className="mt-1 text-[11px] text-[#666672]">
                共 {filteredDocuments.length} 篇文档 · 由 AI 自动索引与摘要
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-[#9ca3af] hover:bg-white/[0.08] hover:text-white xl:hidden"
              onClick={() => setMobileNoticeOpen(true)}
              aria-label="打开通知中心"
            >
              <Bell className="h-4 w-4" />
              {events.some((event) => !event.readAt) && (
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </Button>
            {!noticeVisible && (
              <Button
                variant="ghost"
                size="icon"
                className="relative hidden text-[#9ca3af] hover:bg-white/[0.08] hover:text-white xl:inline-flex"
                onClick={() => setNoticeVisible(true)}
                aria-label="打开通知中心"
              >
                <Bell className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="h-9 rounded-lg bg-[#1e40af] px-3.5 text-xs text-white shadow-none hover:bg-[#1d4ed8]"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploading ? "上传中" : "上传文档"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.pdf,.doc,.docx,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={uploadFile}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666672]" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索文档..."
                    className="h-10 rounded-xl border-white/[0.08] bg-[#16161f] pl-9 text-sm text-[#e5e5e5] placeholder:text-[#555562] focus:border-blue-400/40"
                  />
                </div>
                <div className="flex items-center rounded-xl border border-white/[0.08] bg-[#16161f] p-1">
                  <button
                    type="button"
                    onClick={() => setLayout("grid")}
                    aria-label="网格视图"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      layout === "grid"
                        ? "bg-white/[0.08] text-white"
                        : "text-[#777783] hover:text-white",
                    )}
                  >
                    <Grid2X2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout("list")}
                    aria-label="列表视图"
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      layout === "list"
                        ? "bg-white/[0.08] text-white"
                        : "text-[#777783] hover:text-white",
                    )}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {documentCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      activeCategory === category.id
                        ? "bg-[#1e40af] text-white"
                        : "bg-white/[0.05] text-[#9ca3af] hover:bg-white/[0.08] hover:text-white",
                    )}
                  >
                    {category.name}
                    <span className="ml-1.5 opacity-70">{category.count}</span>
                  </button>
                ))}
              </div>

              {error && (
                <div role="alert" className="mt-4 flex items-center justify-between rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError("")} aria-label="关闭错误提示">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {loading ? (
                <div className="flex min-h-[420px] items-center justify-center text-sm text-[#777783]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在加载文档库
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="mt-6 flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.015] px-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                    {search || activeCategory !== "all" ? (
                      <Search className="h-6 w-6" />
                    ) : (
                      <BookOpen className="h-6 w-6" />
                    )}
                  </span>
                  <h2 className="mt-5 text-base font-semibold text-[#e5e5e5]">
                    {search || activeCategory !== "all" ? "未找到相关文档" : "开始构建你的知识库"}
                  </h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#777783]">
                    {search || activeCategory !== "all"
                      ? "试试其他关键词或切换分类。"
                      : "上传 TXT、Markdown、PDF 或 Word 文档，系统会自动解析、分块并向量化。"}
                  </p>
                  {!search && activeCategory === "all" && (
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-5 bg-[#1e40af] text-white hover:bg-[#1d4ed8]"
                    >
                      <UploadCloud className="h-4 w-4" />
                      上传第一份文档
                    </Button>
                  )}
                </div>
              ) : layout === "grid" ? (
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {filteredDocuments.map((document) => (
                    <DocumentCard
                      key={document.id}
                      document={document}
                      onDelete={(item) => void deleteDocument(item)}
                      onProcess={(item) => void processDocument(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-6 flex flex-col gap-2">
                  {filteredDocuments.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      onDelete={(item) => void deleteDocument(item)}
                      onProcess={(item) => void processDocument(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
          {noticeVisible && (
            <div className="hidden xl:flex">
              <NotificationCenter
                events={events}
                onRead={(event) => void markRead(event)}
                onClose={() => setNoticeVisible(false)}
              />
            </div>
          )}
        </div>
      </main>

      <Drawer open={mobileNoticeOpen} onOpenChange={setMobileNoticeOpen}>
        <DrawerContent className="max-w-[360px] border-white/[0.08] bg-[#111118] p-0 text-[#e5e5e5]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>通知中心</DrawerTitle>
            <DrawerDescription>文档处理通知</DrawerDescription>
          </DrawerHeader>
          <NotificationCenter
            events={events}
            onRead={(event) => void markRead(event)}
            onClose={() => setMobileNoticeOpen(false)}
          />
        </DrawerContent>
      </Drawer>
    </div>
  );
}
