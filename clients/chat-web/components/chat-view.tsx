"use client"

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { api, apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import { isDemoSession } from "@/lib/auth"
import { suggestedQuestions, type ChatMessage } from "@/lib/knowledge-data"
import { Button } from "@/components/ui/button"
import { ComponentRenderer } from "@/components/ai-ui/ComponentRenderer"
import type { AIUIResponse, UIAction, UIResponse } from "@/types/ui-types"
import { ArrowUp, FileText, Loader2, Sparkles, User } from "lucide-react"

type Conversation = {
  id: string
  title: string
  createdAt?: string
  updatedAt?: string
}

type RetrievedDocument = {
  content: string
  score: number
}

type ApiMessage = {
  id: string
  role: "USER" | "ASSISTANT" | "user" | "assistant"
  content: string
  createdAt?: string
  metadata?: unknown
}

type AnalysisResponse = {
  report?: string | null
  intent?: "analyze" | "query" | "chat"
  summary?: string | null
  queryResponse?: string | null
  chatResponse?: string | null
  clarificationQuestions?: string[]
  retrievedDocuments?: RetrievedDocument[]
}

/** 正式会话消息可附带服务端持久化的 AI UI 组件。 */
type RenderableChatMessage = ChatMessage & {
  components?: UIResponse[]
}

type ChatViewProps = {
  /** 从侧栏点选的会话 ID；undefined 表示首次进入时自动打开最近会话。 */
  conversationId?: string
  /**
   * 会话标题由外层会话列表统一维护。
   * 传入后可让侧栏的重命名结果立即同步到聊天区标题，无需重新请求历史消息。
   */
  conversationTitle?: string
  newConversationSignal?: number
  onConversationsChange?: Dispatch<SetStateAction<Conversation[]>>
  onActiveConversationChange?: (id: string | null) => void
}

const DEMO_CONVERSATION: Conversation = {
  id: "demo-conversation",
  title: "需求分析示例",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
}

function formatAssistantReply(response: AnalysisResponse): string {
  if (typeof response.report === "string" && response.report.trim()) {
    return response.report.trim()
  }
  if (response.report && typeof response.report === "object") {
    return JSON.stringify(response.report, null, 2)
  }
  if (typeof response.chatResponse === "string" && response.chatResponse.trim()) {
    return response.chatResponse.trim()
  }
  if (typeof response.queryResponse === "string" && response.queryResponse.trim()) {
    return response.queryResponse.trim()
  }
  if (typeof response.summary === "string" && response.summary.trim()) {
    return response.summary.trim()
  }
  if (response.clarificationQuestions?.length) {
    return [
      "为了继续分析，请补充以下信息：",
      ...response.clarificationQuestions.map((question) => `- ${question}`),
    ].join("\n")
  }
  return "分析已完成，但没有生成可展示的报告。"
}

function toChatMessage(message: ApiMessage): RenderableChatMessage {
  return {
    id: message.id,
    role: message.role === "USER" || message.role === "user" ? "user" : "assistant",
    content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    components: uiComponentsFromMetadata(message.metadata),
  }
}

/**
 * UI 组件随 ASSISTANT 消息 metadata 一起由 Nest 返回。
 * 只读取已知字段；旧消息或普通聊天消息会自然退化为纯文本渲染。
 */
function uiComponentsFromMetadata(metadata: unknown): UIResponse[] | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }
  const ui = (metadata as { ui?: unknown }).ui
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    return undefined
  }
  const components = (ui as { components?: unknown }).components
  return Array.isArray(components) ? (components as UIResponse[]) : undefined
}

/** 需要确定性交互时才启用 UI Flow；其它输入保持现有知识库聊天体验。 */
function shouldUseUiFlow(input: string): boolean {
  return /我要提一个新需求|提一个新需求|查看需求\s*REQ-[A-Za-z0-9-]+|提交需求分析/.test(input)
}

function uiResponseText(response: AIUIResponse): string {
  if (response.message?.trim()) return response.message.trim()
  const text = response.components
    .filter((component) => component.type === "text")
    .map((component) => component.content.trim())
    .filter(Boolean)
    .join("\n\n")
  return text || "请根据下方内容继续操作。"
}

function responseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object") {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) return data as T[]
  }
  return []
}

export function ChatView({
  conversationId,
  conversationTitle,
  newConversationSignal = 0,
  onConversationsChange,
  onActiveConversationChange,
}: ChatViewProps) {
  const [messages, setMessages] = useState<RenderableChatMessage[]>([])
  const [input, setInput] = useState("")
  const [thinking, setThinking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const handledNewSignalRef = useRef(0)
  const newConversationModeRef = useRef(false)
  // 每次切换/新建会话都会递增。旧会话的异步请求完成后必须先校验代次，
  // 避免把旧历史或旧模型响应写进当前会话的 UI。
  const conversationEpochRef = useRef(0)

  const hasMessages = messages.length > 0

  useEffect(() => {
    // 新建或删除当前会话时，在同一个 effect 内完成状态重置，避免另一个加载
    // effect 随后把 loading 重新设为 true，导致空会话永久停留在加载动画。
    if (
      newConversationSignal > 0 &&
      handledNewSignalRef.current !== newConversationSignal
    ) {
      handledNewSignalRef.current = newConversationSignal
      newConversationModeRef.current = true
      conversationEpochRef.current += 1
    }

    // React Strict Mode 会在开发环境重复执行 effect；新建对话模式必须在两次执行间保持。
    if (newConversationModeRef.current && !conversationId) {
      setConversation(null)
      setMessages([])
      setInput("")
      setError("")
      setThinking(false)
      setLoading(false)
      onActiveConversationChange?.(null)
      return
    }
    newConversationModeRef.current = false

    const epoch = ++conversationEpochRef.current

    if (isDemoSession()) {
      // 访客模式没有后端写权限，但仍保留一个本地示例会话，让聊天区域和聊天记录入口可见。
      setConversation(DEMO_CONVERSATION)
      setMessages([])
      setThinking(false)
      setLoading(false)
      onConversationsChange?.([DEMO_CONVERSATION])
      onActiveConversationChange?.(DEMO_CONVERSATION.id)
      return
    }

    let cancelled = false
    const isCurrent = () => !cancelled && conversationEpochRef.current === epoch

    async function loadConversation() {
      // 先清空上一会话的本地状态，避免切换期间短暂显示旧消息。
      setConversation(null)
      setMessages([])
      setThinking(false)
      setLoading(true)
      setError("")
      try {
        const { data: rawConversations } = await api.get<unknown>("/conversations", {
          timeout: 10_000,
        })
        if (!isCurrent()) return

        const conversations = responseArray<Conversation>(rawConversations)
        // 没有历史会话时直接展示空白新对话，不要在初始化阶段创建空记录。
        // 真正发送第一条消息时由 ensureConversation() 创建会话，避免出现默认“新会话”
        // 并让页面在空会话状态下反复加载。
        let active = conversationId
          ? conversations.find((item) => item.id === conversationId) ?? null
          : conversations[0] ?? null
        if (!active) {
          if (conversationId) {
            throw new Error("未找到该会话，可能已被删除")
          }
          if (!isCurrent()) return
          setConversation(null)
          setMessages([])
          onConversationsChange?.(conversations)
          onActiveConversationChange?.(null)
          return
        }

        if (!isCurrent()) return
        setConversation(active)
        onConversationsChange?.(conversations)
        onActiveConversationChange?.(active.id)
        const history = await api.get<unknown>(`/conversations/${active.id}/messages`, {
          timeout: 10_000,
        })
        if (!isCurrent()) return
        setMessages(responseArray<ApiMessage>(history.data).map(toChatMessage))
      } catch (reason) {
        if (isCurrent()) setError(apiErrorMessage(reason))
      } finally {
        if (isCurrent()) setLoading(false)
      }
    }

    void loadConversation()

    return () => {
      cancelled = true
    }
  }, [conversationId, newConversationSignal, onActiveConversationChange, onConversationsChange])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, thinking])

  async function ensureConversation(): Promise<Conversation | null> {
    if (conversation) return conversation
    if (isDemoSession()) {
      setError("请先使用真实 CloudSage 账号登录后再开始 AI 对话。")
      return null
    }
    try {
      const { data } = await api.post<Conversation>("/conversations", { title: "新会话" })
      setConversation(data)
      onConversationsChange?.((current) => [
        data,
        ...current.filter((item) => item.id !== data.id),
      ])
      onActiveConversationChange?.(data.id)
      return data
    } catch (reason) {
      setError(apiErrorMessage(reason))
      return null
    }
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || thinking) return
    const activeConversation = await ensureConversation()
    if (!activeConversation) return
    const epoch = conversationEpochRef.current
    const userMessage: RenderableChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    }
    setMessages((current) => [...current, userMessage])
    setInput("")
    setError("")
    setThinking(true)
    try {
      const data = shouldUseUiFlow(content)
        ? (
            await api.post<AIUIResponse>(
              `/conversations/${activeConversation.id}/ui-chat`,
              { input: content },
              { timeout: 120_000 },
            )
          ).data
        : (
            await api.post<AnalysisResponse>(
              `/conversations/${activeConversation.id}/chat`,
              { input: content },
              // 多 Agent 分析可能需要多次模型调用，不能沿用初始化接口的短超时。
              { timeout: 120_000 },
            )
          ).data
      // 如果用户在模型调用期间切换了会话，丢弃旧会话的响应，
      // 让它只保存在后端原会话中，不得污染当前页面。
      if (conversationEpochRef.current !== epoch) return
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "components" in data ? uiResponseText(data) : formatAssistantReply(data),
          ...( "components" in data
            ? { components: data.components }
            : {
                citations: data.retrievedDocuments?.map((document, index) => ({
                  docId: `source-${index}`,
                  title: `知识库片段 ${index + 1}`,
                  snippet: document.content,
                })),
              }),
        },
      ])
      setConversation((current) =>
        current ? { ...current, title: current.title === "新会话" ? content.slice(0, 24) : current.title } : current,
      )
      onConversationsChange?.((current) => {
        const updatedTitle = activeConversation.title === "新会话" ? content.slice(0, 24) : activeConversation.title
        const updated = { ...activeConversation, title: updatedTitle }
        return [updated, ...current.filter((item) => item.id !== updated.id)]
      })
    } catch (reason) {
      if (conversationEpochRef.current === epoch) setError(apiErrorMessage(reason))
    } finally {
      if (conversationEpochRef.current === epoch) setThinking(false)
    }
  }

  /** 由 ComponentRenderer 回传 UIAction，并由会话级 API 推进持久化状态机。 */
  async function handleUiAction(action: UIAction) {
    if (!conversation || thinking) return
    const activeConversation = conversation
    const epoch = conversationEpochRef.current
    setError("")
    setThinking(true)
    try {
      const { data } = await api.post<AIUIResponse>(
        `/conversations/${activeConversation.id}/ui-action`,
        { action },
        { timeout: 30_000 },
      )
      if (conversationEpochRef.current !== epoch) return
      setMessages((current) => [
        ...current,
        {
          id: `assistant-ui-${Date.now()}`,
          role: "assistant",
          content: uiResponseText(data),
          components: data.components,
        },
      ])
    } catch (reason) {
      if (conversationEpochRef.current === epoch) setError(apiErrorMessage(reason))
    } finally {
      if (conversationEpochRef.current === epoch) setThinking(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-8 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-foreground">
            {conversationTitle || conversation?.title || "AI 对话"}
          </h1>
          <p className="text-xs text-muted-foreground">基于你的知识库回答，并标注来源</p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <ConversationLoading />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} onAction={handleUiAction} />
            ))}
            {!hasMessages && !thinking && (
              <div className="flex min-h-[min(58vh,520px)] flex-col items-center justify-center gap-5 py-10 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="size-7" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">今天想分析什么需求？</p>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                    我会结合会话历史与团队知识库，完成需求澄清、功能拆解、风险识别和报告汇总。
                  </p>
                </div>
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {suggestedQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void send(question)}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {thinking && <ThinkingBubble />}
            {error && <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="向知识库提问，例如：新员工的入职流程是什么？"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Button size="icon" onClick={() => void send(input)} disabled={!input.trim() || thinking || loading} aria-label="发送">
              {thinking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">AI 回答可能存在偏差，请结合引用来源核实</p>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onAction,
}: {
  message: RenderableChatMessage
  onAction: (action: UIAction) => void
}) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", isUser ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground")}>
        {isUser ? <User className="size-4" /> : <Sparkles className="size-4" />}
      </div>
      <div className={cn("flex max-w-[85%] flex-col gap-2", isUser && "items-end")}>
        <div className={cn("whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed", isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground")}>
          {message.content}
        </div>
        {!isUser && message.components && message.components.length > 0 && (
          <div className="w-full space-y-3">
            {message.components.map((component, index) => (
              <ComponentRenderer
                key={`${message.id}-component-${index}`}
                component={component}
                onAction={onAction}
                className="max-w-full"
              />
            ))}
          </div>
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">引用来源</span>
            {message.citations.map((citation) => (
              <div key={citation.docId} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 transition-colors hover:border-ring/40">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <FileText className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{citation.title}</p>
                  <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{citation.snippet}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Sparkles className="size-4" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card px-4 py-3.5">
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground" />
      </div>
    </div>
  )
}

/** 会话切换期间只保留极简环形进度标识，不渲染骨架块或提示文字。 */
function ConversationLoading() {
  return (
    <div
      className="flex h-full min-h-[240px] items-center justify-center bg-background"
      role="status"
      aria-label="会话内容加载中"
    >
      <svg
        viewBox="0 0 48 48"
        className="size-9 animate-spin [animation-duration:1.15s]"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 0 2px rgba(82, 82, 91, 0.2))" }}
      >
        <defs>
          <linearGradient
            id="conversation-loading-gradient"
            gradientUnits="userSpaceOnUse"
            x1="8"
            y1="8"
            x2="40"
            y2="40"
          >
            <stop offset="0%" stopColor="#f4f4f5" />
            <stop offset="48%" stopColor="#a1a1aa" />
            <stop offset="100%" stopColor="#27272a" />
          </linearGradient>
        </defs>
        <circle
          cx="24"
          cy="24"
          r="15"
          fill="none"
          stroke="url(#conversation-loading-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="76 19"
          transform="rotate(-45 24 24)"
        />
      </svg>
    </div>
  )
}
