"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { getCurrentUser, isDemoSession } from "@/lib/auth";

interface Conversation {
  id: string;
  title: string;
}

interface Message {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

interface AnalysisResponse {
  report?: string | null;
  clarificationQuestions?: string[];
}

const DEMO_REPLY =
  "演示模式已收到这条需求。登录真实账号后，我会调用当前 Nest 服务完成需求分析。";

function formatAssistantReply(response: AnalysisResponse): string {
  if (response.report?.trim()) return response.report.trim();

  if (response.clarificationQuestions?.length) {
    return [
      "为了继续分析，请补充以下信息：",
      ...response.clarificationQuestions.map((question) => `- ${question}`),
    ].join("\n");
  }

  return "分析已完成，但没有生成可展示的报告。";
}

/**
 * 复刻参考项目的最小聊天容器，同时把消息发送替换为当前 Nest 会话接口。
 */
export function AIChatContainer({ sessionId }: { sessionId: string }) {
  const [conversationId, setConversationId] = useState(sessionId);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ASSISTANT",
      content:
        "欢迎使用 CloudSage AI 需求分析助理，请描述你的需求，或点击下方常用功能。",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConversation() {
      if (isDemoSession() || !getCurrentUser()) {
        if (!cancelled) setInitializing(false);
        return;
      }

      try {
        const { data: conversations } = await api.get<Conversation[]>(
          "/conversations",
        );
        let conversation = conversations[0];

        if (!conversation) {
          const response = await api.post<Conversation>("/conversations", {
            title: "新会话",
          });
          conversation = response.data;
        }

        if (cancelled) return;
        setConversationId(conversation.id);
        const { data: history } = await api.get<Message[]>(
          `/conversations/${conversation.id}/messages`,
        );
        setMessages(
          history.length
            ? history
            : [
                {
                  id: "welcome",
                  role: "ASSISTANT",
                  content:
                    "欢迎使用 CloudSage AI 需求分析助理，请描述你的需求，或点击下方常用功能。",
                },
              ],
        );
      } catch (reason) {
        if (!cancelled) setError(apiErrorMessage(reason));
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    void loadConversation();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading || initializing) return;

    setMessages((previous) => [
      ...previous,
      { id: `user-${Date.now()}`, role: "USER", content: text },
    ]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      let content = DEMO_REPLY;
      if (!isDemoSession() && getCurrentUser()) {
        const { data } = await api.post<AnalysisResponse>(
          `/conversations/${conversationId}/chat`,
          { input: text },
        );
        content = formatAssistantReply(data);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
      }

      setMessages((previous) => [
        ...previous,
        { id: `assistant-${Date.now()}`, role: "ASSISTANT", content },
      ]);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => {
          const isUser = message.role === "USER";
          return (
            <div key={message.id} className={isUser ? "flex justify-end" : "space-y-2"}>
              <div
                className={
                  isUser
                    ? "max-w-[80%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white"
                    : "max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800"
                }
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          );
        })}
        {loading && <div className="text-xs text-slate-400">AI 正在思考中…</div>}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
      <form onSubmit={(event) => void handleSend(event)} className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="描述你的需求，例如：我要提一个新需求…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={initializing || loading}
        />
        <button
          type="submit"
          disabled={initializing || loading || !input.trim()}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  );
}
