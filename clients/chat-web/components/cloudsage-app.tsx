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
  buildCategoryOptions,
  documents as demoDocuments,
  mapDocumentRecord,
  type Category,
  type DocumentCategoryValue,
  type DocumentRecord,
  type KnowledgeDoc,
} from "@/lib/knowledge-data"
import {
  createCategory as requestCreateCategory,
  deleteCategory as requestDeleteCategory,
  listCategories,
  type UserCategory,
} from "@/lib/categories"
import { Sidebar, type SidebarConversation } from "@/components/sidebar"
import { DocumentsView } from "@/components/documents-view"
import { DocumentPreviewDialog } from "@/components/document-preview-dialog"
import { GlobalSearch } from "@/components/global-search"
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
  const [previewDocument, setPreviewDocument] = useState<KnowledgeDoc | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  /** 用户自建分类（内置分类不通过接口返回）。 */
  const [customCategories, setCustomCategories] = useState<UserCategory[]>([])
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
  const categories = useMemo<Category[]>(
    () => buildCategories(documents, customCategories),
    [documents, customCategories],
  )
  // 上传与改分类下拉框的选项：内置分类 + 用户自建分类。
  const categoryOptions = useMemo(
    () => buildCategoryOptions(customCategories),
    [customCategories],
  )
  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + (document.chunkCount ?? 0), 0),
    [documents],
  )
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

  // 演示身份的「载入示例资料」：直接恢复内置示例文档，不写入真实库。
  const loadDemoDocuments = useCallback(() => {
    setDocuments(demoDocuments)
    setDocumentsError("")
  }, [])

  // 自定义分类读取失败不影响文档列表，侧栏退化为只显示内置分类。
  const loadCategories = useCallback(async () => {
    if (isDemoSession()) {
      setCustomCategories([])
      return
    }
    try {
      setCustomCategories(await listCategories())
    } catch {
      setCustomCategories([])
    }
  }, [])

  /**
   * 新建自定义分类。异常直接抛给侧栏弹窗展示，成功后刷新列表让入口立刻出现，
   * 并把新建的分类作为当前筛选，省掉用户再点一次。
   */
  async function createCategory(name: string) {
    const created = await requestCreateCategory(name.trim())
    await loadCategories()
    setActiveCategory(created.id)
  }

  /**
   * 删除自定义分类。后端会把该分类下的文档回落到内置分类，所以要连带刷新文档；
   * 若当前正停在被删除的分类上，则退回「全部文档」，避免停留在一个已不存在的分类。
   */
  async function deleteCategory(id: string) {
    await requestDeleteCategory(id)
    if (activeCategory === id) setActiveCategory("all")
    await Promise.all([loadCategories(), loadDocuments()])
  }

  useEffect(() => {
    const current = getSession()
    setSession(current)
    setHydrated(true)
    if (!current) {
      router.replace("/login")
      return
    }
    void loadDocuments()
    void loadCategories()
  }, [loadCategories, loadDocuments, router])

  // Ctrl/Cmd + K 唤起全局语义检索。输入框内同样允许触发，方便连续检索。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  async function uploadDocument(file: File, category?: DocumentCategoryValue) {
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
      if (category) formData.append("category", category)
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

  async function updateDocumentCategory(
    document: KnowledgeDoc,
    category: DocumentCategoryValue,
  ) {
    if (demo) {
      setDocumentsError("演示身份不能修改文档分类，请使用真实账号。")
      return
    }

    const previousCategory = document.category
    setDocuments((current) =>
      current.map((item) => (item.id === document.id ? { ...item, category } : item)),
    )
    setDocumentsError("")
    try {
      await api.patch(`/documents/${document.id}/category`, { category })
    } catch (reason) {
      setDocuments((current) =>
        current.map((item) =>
          item.id === document.id ? { ...item, category: previousCategory } : item,
        ),
      )
      setDocumentsError(apiErrorMessage(reason))
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
      if (previewDocument?.id === document.id) setPreviewDocument(null)
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
        documentCount={documents.length}
        chunkCount={totalChunks}
        // 演示身份只读，不提供分类增删入口。
        onCreateCategory={demo ? undefined : createCategory}
        onDeleteCategory={demo ? undefined : deleteCategory}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        {view === "documents" ? (
          <DocumentsView
            documents={documents}
            categories={categories}
            categoryOptions={categoryOptions}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            loading={documentsLoading}
            error={documentsError}
            uploading={uploading}
            onUpload={uploadDocument}
            onDocumentCategoryChange={updateDocumentCategory}
            onProcess={processDocument}
            onDelete={deleteDocument}
            onPreview={setPreviewDocument}
            onLoadDemo={demo ? loadDemoDocuments : undefined}
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
      <DocumentPreviewDialog
        document={previewDocument}
        open={previewDocument !== null}
        demo={demo}
        onOpenChange={(open) => {
          if (!open) setPreviewDocument(null)
        }}
      />
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        documents={documents}
        demo={demo}
        onSelectDocument={setPreviewDocument}
      />
    </main>
  )
}
