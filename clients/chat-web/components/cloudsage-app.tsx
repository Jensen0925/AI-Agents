"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { api, apiErrorMessage } from "@/lib/api"
import {
  clearSession,
  getSession,
  isDemoSession,
  type Session,
} from "@/lib/auth"
import {
  buildCategories,
  documents as demoDocuments,
  mapDocumentRecord,
  type Category,
  type DocumentRecord,
  type KnowledgeDoc,
} from "@/lib/knowledge-data"
import { Sidebar, type SidebarConversation } from "@/components/sidebar"
import { DocumentsView } from "@/components/documents-view"
import { ChatView } from "@/components/chat-view"

type View = "documents" | "chat"

type CloudSageAppProps = {
  initialView?: View
}

export function CloudSageApp({ initialView = "documents" }: CloudSageAppProps) {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<View>(initialView)
  const [activeCategory, setActiveCategory] = useState("all")
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentsError, setDocumentsError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [newConversationSignal, setNewConversationSignal] = useState(0)
  const [conversations, setConversations] = useState<SidebarConversation[]>([])
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  // 只有用户从侧栏点选会话时才传给 ChatView，避免 ChatView 自己创建会话后被重复加载。
  const [conversationToOpen, setConversationToOpen] = useState<string | undefined>(undefined)
  // 删除请求是异步的，使用 ref 读取最新的会话选择，避免请求期间切换会话后
  // 旧删除回调把新会话错误地重置成空白页。
  const activeConversationIdRef = useRef<string | null>(null)
  const conversationToOpenRef = useRef<string | undefined>(undefined)

  const demo = hydrated && isDemoSession()
  const categories = useMemo<Category[]>(() => buildCategories(documents), [documents])
  const pinnedConversationStorageKey = session
    ? `cloudsage:pinned-conversations:${session.user.id}`
    : null

  useEffect(() => {
    if (!hydrated || !session || !pinnedConversationStorageKey) return
    try {
      const raw = window.localStorage.getItem(pinnedConversationStorageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      setPinnedConversationIds(
        Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === "string")
          : [],
      )
    } catch {
      setPinnedConversationIds([])
    }
  }, [hydrated, pinnedConversationStorageKey, session])

  const displayConversations = useMemo(
    () =>
      conversations.map((conversation) => ({
        ...conversation,
        pinned: pinnedConversationIds.includes(conversation.id),
      })),
    [conversations, pinnedConversationIds],
  )
  // 聊天区标题与侧栏共用同一份会话列表数据。这样在侧栏重命名当前会话后，
  // 不需要等待下一次会话历史请求，顶部标题即可立即更新。
  const activeConversationTitle = useMemo(
    () =>
      activeConversationId
        ? conversations.find((conversation) => conversation.id === activeConversationId)
            ?.title
        : undefined,
    [activeConversationId, conversations],
  )

  const loadDocuments = useCallback(async () => {
    if (isDemoSession()) {
      setDocuments(demoDocuments)
      setDocumentsLoading(false)
      return
    }
    setDocumentsLoading(true)
    setDocumentsError("")
    try {
      const { data } = await api.get<DocumentRecord[]>("/documents")
      setDocuments(data.map(mapDocumentRecord))
    } catch (reason) {
      setDocumentsError(apiErrorMessage(reason))
    } finally {
      setDocumentsLoading(false)
    }
  }, [])

  useEffect(() => {
    const current = getSession()
    setSession(current)
    setHydrated(true)
    if (!current) {
      router.replace("/login")
      return
    }
    void loadDocuments()
  }, [loadDocuments, router])

  async function uploadDocument(file: File) {
    if (demo) {
      setDocumentsError("演示身份只能浏览示例文档，请使用真实账号上传文件。")
      return
    }
    setUploading(true)
    setDocumentsError("")
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("filename", file.name)
      const { data } = await api.post<DocumentRecord>("/documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      await api.post(`/documents/${data.id}/process`)
      await loadDocuments()
      window.setTimeout(() => void loadDocuments(), 1500)
    } catch (reason) {
      setDocumentsError(apiErrorMessage(reason))
    } finally {
      setUploading(false)
    }
  }

  async function processDocument(document: KnowledgeDoc) {
    if (demo) {
      setDocumentsError("演示身份不能处理文档，请使用真实账号。")
      return
    }
    try {
      await api.post(`/documents/${document.id}/process`)
      await loadDocuments()
      window.setTimeout(() => void loadDocuments(), 1500)
    } catch (reason) {
      setDocumentsError(apiErrorMessage(reason))
    }
  }

  async function deleteDocument(document: KnowledgeDoc) {
    if (demo) {
      setDocumentsError("演示身份不能删除文档，请使用真实账号。")
      return
    }
    if (!window.confirm(`确认删除文档“${document.title}”？`)) return
    try {
      await api.delete(`/documents/${document.id}`)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
    } catch (reason) {
      setDocumentsError(apiErrorMessage(reason))
    }
  }

  function createConversation() {
    activeConversationIdRef.current = null
    conversationToOpenRef.current = undefined
    setView("chat")
    setActiveConversationId(null)
    setConversationToOpen(undefined)
    setNewConversationSignal((signal) => signal + 1)
  }

  function openConversation(id: string) {
    activeConversationIdRef.current = id
    conversationToOpenRef.current = id
    setView("chat")
    setActiveConversationId(id)
    setConversationToOpen(id)
  }

  const handleActiveConversationChange = useCallback((id: string | null) => {
    activeConversationIdRef.current = id
    setActiveConversationId(id)
  }, [])

  async function deleteConversation(id: string) {
    if (demo) {
      throw new Error("演示身份不能删除会话，请使用真实账号。")
    }

    await api.delete(`/conversations/${id}`)
    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== id,
    )
    setConversations(remainingConversations)
    setPinnedConversationIds((current) => {
      if (!current.includes(id)) return current
      const next = current.filter((conversationId) => conversationId !== id)
      if (pinnedConversationStorageKey) {
        window.localStorage.setItem(pinnedConversationStorageKey, JSON.stringify(next))
      }
      return next
    })

    // 删除当前会话后优先打开剩余的最近会话；删除最后一个会话时才回到
    // 空白新对话。这样既不会继续展示已删除内容，也不会停在无归属的加载态。
    // 用 ref 判断最新选择，避免用户在删除请求期间切换到其他会话后被误清空。
    if (activeConversationIdRef.current === id || conversationToOpenRef.current === id) {
      const nextConversation = remainingConversations[0]
      if (nextConversation) {
        openConversation(nextConversation.id)
      } else {
        createConversation()
      }
    }
  }

  async function renameConversation(id: string, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle) throw new Error("会话名称不能为空")

    if (demo) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...conversation, title: nextTitle } : conversation,
        ),
      )
      return
    }

    const { data } = await api.patch<SidebarConversation>(`/conversations/${id}`, {
      title: nextTitle,
    })
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, title: data.title || nextTitle, updatedAt: data.updatedAt }
          : conversation,
      ),
    )
  }

  function pinConversation(id: string) {
    setPinnedConversationIds((current) => {
      const next = current.includes(id)
        ? current.filter((conversationId) => conversationId !== id)
        : [...current, id]
      if (pinnedConversationStorageKey) {
        window.localStorage.setItem(pinnedConversationStorageKey, JSON.stringify(next))
      }
      return next
    })
  }

  function logout() {
    clearSession()
    router.replace("/login")
  }

  if (!hydrated || !session) {
    return <main className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">正在加载 CloudSage…</main>
  }

  return (
    <main className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        view={view}
        onViewChange={setView}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        categories={categories}
        userName={session.user.name}
        userEmail={session.user.email}
        onNewConversation={createConversation}
        conversations={displayConversations}
        activeConversationId={activeConversationId}
        onSelectConversation={openConversation}
        onPinConversation={pinConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        onLogout={logout}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        {view === "documents" ? (
          <DocumentsView
            documents={documents}
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            loading={documentsLoading}
            error={documentsError}
            uploading={uploading}
            onUpload={uploadDocument}
            onProcess={processDocument}
            onDelete={deleteDocument}
          />
        ) : (
          <ChatView
            conversationId={conversationToOpen}
            conversationTitle={activeConversationTitle}
            newConversationSignal={newConversationSignal}
            onConversationsChange={setConversations}
            onActiveConversationChange={handleActiveConversationChange}
          />
        )}
      </div>
    </main>
  )
}
