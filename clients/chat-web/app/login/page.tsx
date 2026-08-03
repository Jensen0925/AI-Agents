"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { api, apiErrorMessage } from "@/lib/api"
import { saveDemoSession, saveSession, type Session } from "@/lib/auth"
import {
  CloudLightning,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Mail,
  Sparkles,
  TriangleAlert,
} from "lucide-react"

const highlights = [
  {
    icon: FileText,
    title: "统一文档中心",
    desc: "集中管理团队知识，分类清晰、检索高效",
  },
  {
    icon: Sparkles,
    title: "AI 智能问答",
    desc: "基于知识库即时作答，并标注可信来源",
  },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("admin@cloudsage.local")
  const [password, setPassword] = useState("Cloudsage@123")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim() || loading) return
    setLoading(true)
    setError("")
    try {
      const { data } = await api.post<Session>("/auth/login", {
        email: email.trim(),
        password,
      })
      saveSession(data)
      router.replace("/")
    } catch (reason) {
      setError(apiErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen w-full bg-background">
      {/* 左侧品牌区 */}
      <section className="relative hidden w-1/2 flex-col justify-between bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CloudLightning className="size-5" />
          </div>
          <span className="text-base font-semibold text-sidebar-foreground">CloudSage</span>
        </div>

        <div className="flex max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="text-balance text-3xl font-semibold leading-snug text-foreground">
              让团队知识流动起来，用 AI 即时获取答案
            </h1>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              CloudSage 将文档管理与 AI 对话融为一体，帮助团队沉淀经验、快速找到所需信息。
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {highlights.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <item.icon className="size-4.5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">© 2026 CloudSage. 保留所有权利。</p>
      </section>

      {/* 右侧登录表单 */}
      <section className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CloudLightning className="size-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">CloudSage</span>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex flex-col gap-2 text-center">
              <h2 className="text-2xl font-semibold text-foreground">欢迎回来</h2>
              <p className="text-sm text-muted-foreground">登录你的 CloudSage 账户</p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  邮箱
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-foreground">
                    密码
                  </label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    忘记密码？
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入密码"
                    className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" size="lg" className="mt-2 w-full gap-2" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                {loading ? "登录中…" : "登录"}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">或</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => {
                saveDemoSession()
                router.replace("/")
              }}
            >
              以访客身份浏览
            </Button>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              还没有账户？{" "}
              <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                立即注册
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
