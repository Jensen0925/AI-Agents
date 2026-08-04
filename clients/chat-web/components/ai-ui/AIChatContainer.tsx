"use client";

import Link from "next/link";
import {
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Check,
  Copy,
  FileText,
  Loader2,
  Menu,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { getCurrentUser, isDemoSession } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { ComponentRenderer } from "@/components/ai-ui/ComponentRenderer";
import type { AIUIResponse, UIAction, UIResponse } from "@/types/ui-types";
import {
  DarkSidebar,
  DEMO_EVENTS,
  NotificationCenter,
  type SidebarConversation,
  type TaskEvent,
} from "@/components/knowledge-base";

interface Conversation {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RetrievedDocument {
  content: string;
  score: number;
}

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt?: string;
  sources?: RetrievedDocument[];
  components?: UIResponse[];
}

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "");

/** UI 协议接口使用绝对地址时绕过 Next 代理，否则复用 axios 的 /api baseURL。 */
function uiEndpoint(path: "chat" | "action"): string {
  return configuredApiBase
    ? `${configuredApiBase}/api/ui-chat/${path}`
    : `/ui-chat/${path}`;
}

const QUICK_PROMPTS = [
  {
    title: "检查需求完整性",
    description: "识别缺失信息并生成澄清问题",
    prompt: "分析这个需求是否完整，并列出缺失信息",
  },
  {
    title: "拆解用户故事",
    description: "输出功能拆解和验收标准",
    prompt: "把需求拆成用户故事和验收标准",
  },
  {
    title: "评估风险依赖",
    description: "识别技术风险与外部依赖",
    prompt: "识别这个需求的技术风险与外部依赖",
  },
];

const DEMO_CONVERSATION: Conversation = {
  id: "demo-conversation",
  title: "需求分析示例",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function formatTime(value?: string): string {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function MessageRow({ message, onAction }: { message: Message; onAction: (action: UIAction) => void }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "USER";

  async function copyMessage() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] sm:max-w-[76%]">
          <div className="rounded-2xl rounded-br-md bg-[#1e40af] px-4 py-3 text-sm leading-6 text-white shadow-[0_10px_28px_rgba(30,64,175,0.18)]">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
          <p className="mt-1.5 pr-1 text-right text-[10px] text-[#666672]">
            {formatTime(message.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="flex gap-3.5">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/10">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#e5e5e5]">CloudSage AI</p>
          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] font-medium text-emerald-400">
            知识库增强
          </span>
        </div>
        {message.content && (
          <div className="mt-2 max-w-[780px] text-[14px] leading-7 text-[#c9c9d2]">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}

        {message.components && message.components.length > 0 && (
          <div className="mt-3 max-w-[780px] space-y-3">
            {message.components.map((component, index) => (
              <ComponentRenderer
                key={`${message.id}-component-${index}`}
                component={component}
                onAction={onAction}
              />
            ))}
          </div>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[#777783]">
              <BookOpen className="h-3.5 w-3.5" />
              引用来源 · {message.sources.length}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {message.sources.map((source, index) => (
                <div
                  key={`${message.id}-source-${index}`}
                  className="rounded-xl border border-white/[0.08] bg-[#16161f] p-3 transition-colors hover:border-blue-400/25"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[#d7d7df]">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-blue-300" />
                      <span className="truncate">知识库片段 {index + 1}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-emerald-400">
                      {(source.score * 100).toFixed(0)}% 匹配
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-[#777783]">
                    {source.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copyMessage()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#666672] transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label={copied ? "已复制" : "复制回答"}
            title={copied ? "已复制" : "复制回答"}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <span className="text-[10px] text-[#666672]">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    </article>
  );
}

function EmptyConversation({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[850px] flex-col justify-center px-5 py-10 sm:px-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/10">
        <Sparkles className="h-5 w-5" />
      </div>
      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">
        CloudSage Requirement Intelligence
      </p>
      <h2 className="mt-3 text-[28px] font-semibold leading-tight text-[#e5e5e5] sm:text-[34px]">
        今天想分析什么需求？
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-[#9ca3af]">
        我会结合当前会话历史与团队知识库，完成需求澄清、功能拆解、风险识别和报告汇总，并标注检索来源。
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {QUICK_PROMPTS.map((item, index) => (
          <button
            key={item.prompt}
            type="button"
            onClick={() => onPrompt(item.prompt)}
            className="group min-h-[126px] rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-[#1a1a24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-[10px] font-semibold text-blue-300">
              0{index + 1}
            </span>
            <span className="mt-4 block text-xs font-semibold text-[#d7d7df] group-hover:text-blue-200">
              {item.title}
            </span>
            <span className="mt-1.5 block text-[11px] leading-5 text-[#777783]">
              {item.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AIChatContainer() {
  const [hydrated, setHydrated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileNoticeOpen, setMobileNoticeOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [noticeError, setNoticeError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const preview = hydrated && (isDemoSession() || !getCurrentUser());
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [activeId, conversations],
  );
  const sidebarConversations = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
  })) satisfies SidebarConversation[];

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function loadConversations() {
      if (preview) {
        setConversations([DEMO_CONVERSATION]);
        setActiveId(DEMO_CONVERSATION.id);
        setEvents(DEMO_EVENTS);
        return;
      }
      try {
        const { data } = await api.get<Conversation[]>("/conversations");
        if (cancelled) return;
        if (data.length > 0) {
          setConversations(data);
          setActiveId(data[0].id);
        } else {
          const { data: created } = await api.post<Conversation>("/conversations", {
            title: "新会话",
          });
          setConversations([created]);
          setActiveId(created.id);
        }
        const taskResponse = await api.get<{ items: TaskEvent[] }>("/tasks/history", {
          params: { pageSize: 20 },
        });
        if (!cancelled) setEvents(taskResponse.data.items);
      } catch (reason) {
        if (!cancelled) setError(apiErrorMessage(reason));
      }
    }

    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [hydrated, preview]);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    if (preview) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    void api
      .get<Message[]>(`/conversations/${activeId}/messages`)
      .then(({ data }) => {
        if (!cancelled) setMessages(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(apiErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, hydrated, preview]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function createConversation(): Promise<Conversation | null> {
    setError("");
    try {
      const conversation = preview
        ? {
            ...DEMO_CONVERSATION,
            id: `demo-${Date.now()}`,
            title: "新会话",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : (
            await api.post<Conversation>("/conversations", {
              title: "新会话",
            })
          ).data;
      setConversations((current) => [conversation, ...current]);
      setActiveId(conversation.id);
      setMessages([]);
      setMobileNavOpen(false);
      return conversation;
    } catch (reason) {
      setError(apiErrorMessage(reason));
      return null;
    }
  }

  async function deleteConversation(id: string) {
    const target = conversations.find((item) => item.id === id);
    if (!target || !window.confirm(`确认删除会话“${target.title}”？`)) return;
    try {
      if (!preview) await api.delete(`/conversations/${id}`);
      const next = conversations.filter((item) => item.id !== id);
      setConversations(next);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? "");
        setMessages([]);
      }
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }

  async function sendText(rawText: string) {
    const text = rawText.trim();
    if (!text || sending) return;

    let conversationId = activeId;
    if (!conversationId) {
      conversationId = (await createConversation())?.id ?? "";
      if (!conversationId) return;
    }

    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "USER", content: text, createdAt: now },
    ]);
    setConversations((current) =>
      current.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              title: item.title === "新会话" ? text.slice(0, 24) : item.title,
              updatedAt: now,
            }
          : item,
      ),
    );
    setInput("");
    setError("");
    setSending(true);
    try {
      const response = preview
        ? null
        : await api.post<AIUIResponse>(uiEndpoint("chat"), {
            sessionId: conversationId,
            input: text,
            history: messages.map((message) => ({
              role: message.role === "ASSISTANT" ? "assistant" : "user",
              content: message.content,
            })),
          });
      const content = response?.data.message?.trim() || (response ? "请按下方提示继续。" : "演示模式已收到需求。使用真实账号登录后，我会结合知识库和会话历史完成完整分析。");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "ASSISTANT",
          content,
          createdAt: new Date().toISOString(),
          components: response?.data.components,
        },
      ]);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  /** 将卡片、表单和确认操作回传给 UI 状态机，并把下一步组件追加到当前会话。 */
  async function handleUIAction(action: UIAction) {
    if (!activeId || sending || preview) return;
    setError("");
    setSending(true);
    try {
      const { data } = await api.post<AIUIResponse>(uiEndpoint("action"), {
        sessionId: activeId,
        action,
      });
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "ASSISTANT",
          content: data.message?.trim() || "请按下方提示继续。",
          components: data.components,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setSending(false);
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
      setNoticeError(apiErrorMessage(reason));
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    void sendText(input);
  }

  function openNotifications() {
    if (window.matchMedia("(min-width: 1280px)").matches) setNoticeVisible(true);
    else setMobileNoticeOpen(true);
  }

  const sidebar = (
    <DarkSidebar
      mobile={mobileNavOpen}
      active="conversation"
      recentConversations={sidebarConversations}
      activeConversationId={activeId}
      onNew={() => void createConversation()}
      onOpenNotifications={openNotifications}
      notificationUnread={events.some((item) => !item.readAt)}
      onSelectConversation={(id) => {
        setError("");
        setActiveId(id);
        setMobileNavOpen(false);
      }}
      onDeleteConversation={(id) => void deleteConversation(id)}
      onClose={() => setMobileNavOpen(false)}
    />
  );

  return (
    <div className="flex h-screen min-h-[620px] overflow-hidden bg-[#0a0a0f] text-[#e5e5e5]">
      <div className="hidden h-full shrink-0 lg:flex">{sidebar}</div>
      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerContent className="max-w-[280px] border-white/[0.08] bg-[#111118] p-0 text-[#e5e5e5]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>主导航</DrawerTitle>
            <DrawerDescription>CloudSage 会话导航</DrawerDescription>
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
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-[#e5e5e5]">
                {activeConversation?.title || "新会话"}
              </h1>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-[#777783]">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", preview ? "bg-amber-400" : "bg-emerald-400")} />
                <span>需求分析助手</span>
                <span className="text-[#444450]">·</span>
                <span className="truncate">
                  {preview ? "演示模式 · 本地数据" : "Nest API · 知识库增强"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/knowledge-base"
              className="hidden h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-[#9ca3af] transition-colors hover:bg-white/[0.06] hover:text-white sm:flex"
            >
              <BookOpen className="h-3.5 w-3.5" />
              文档库
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-[#9ca3af] hover:bg-white/[0.08] hover:text-white xl:hidden"
              onClick={() => setMobileNoticeOpen(true)}
              aria-label="打开通知中心"
            >
              <Bell className="h-4 w-4" />
              {events.some((item) => !item.readAt) && (
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
              onClick={() => void createConversation()}
              className="h-8 rounded-lg bg-[#1e40af] px-3 text-xs text-white shadow-none hover:bg-[#1d4ed8]"
            >
              <Plus className="h-3.5 w-3.5" />
              新会话
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="flex h-full items-center justify-center text-sm text-[#777783]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在加载会话
                </div>
              ) : messages.length === 0 ? (
                <EmptyConversation onPrompt={(prompt) => void sendText(prompt)} />
              ) : (
                <div className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
                  {messages.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      onAction={(action) => void handleUIAction(action)}
                    />
                  ))}
                  {sending && (
                    <div className="flex gap-3.5" aria-live="polite">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
                        <Bot className="h-4 w-4" />
                      </span>
                      <div className="pt-0.5">
                        <p className="text-xs font-semibold text-[#e5e5e5]">CloudSage AI</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-[#777783]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在检索知识库并编排分析 Agent
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-white/[0.08] bg-[#0a0a0f]/95 px-3 pb-3 pt-3 backdrop-blur sm:px-6 sm:pb-4">
              <div className="mx-auto w-full max-w-[900px]">
                {error && (
                  <div role="alert" className="mb-2 flex items-center justify-between rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError("")} aria-label="关闭错误提示">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={submit}
                  className="rounded-2xl border border-white/[0.1] bg-[#16161f] p-2 shadow-[0_16px_42px_rgba(0,0,0,0.22)] transition-colors focus-within:border-blue-400/40 focus-within:ring-2 focus-within:ring-blue-400/10"
                >
                  <label htmlFor="chat-input" className="sr-only">输入需求描述</label>
                  <Textarea
                    id="chat-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        submit();
                      }
                    }}
                    placeholder="向 CloudSage 提问，或描述一段待分析的需求..."
                    rows={1}
                    disabled={sending}
                    className="field-sizing-content max-h-40 min-h-[48px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-6 text-[#e5e5e5] shadow-none placeholder:text-[#666672] focus:ring-0"
                  />
                  <div className="flex items-center justify-between gap-3 px-1 pb-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-[#666672]">
                      <Search className="h-3.5 w-3.5" />
                      自动检索当前用户知识库
                      <span className="hidden sm:inline">· Enter 发送</span>
                    </div>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={sending || !input.trim()}
                      className="h-9 w-9 rounded-xl bg-[#1e40af] shadow-none hover:bg-[#1d4ed8]"
                      aria-label="发送消息"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </Button>
                  </div>
                </form>
                <p className="mt-2 text-center text-[10px] text-[#666672]">
                  AI 生成内容可能存在偏差，重要需求请结合引用来源复核。
                </p>
              </div>
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

      {noticeError && (
        <div role="status" className="fixed bottom-4 right-4 z-40 rounded-lg border border-red-400/20 bg-[#1b1115] px-3 py-2 text-xs text-red-300">
          {noticeError}
          <button
            type="button"
            className="ml-2 text-red-200 hover:text-white"
            onClick={() => setNoticeError("")}
            aria-label="关闭提示"
          >
            <X className="inline h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
