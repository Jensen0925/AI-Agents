"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { saveDemoSession, saveSession, type Session } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@cloudsage.local");
  const [password, setPassword] = useState("Cloudsage@123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post<Session>("/auth/login", { email, password });
      saveSession(data);
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  function enterDemo() {
    saveDemoSession();
    window.location.assign("/dashboard");
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(360px,0.95fr)_1.05fr]">
      <section className="hidden bg-blue-800 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div>
          <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-sm font-bold text-blue-800">C</span><span className="text-lg font-bold">CloudSage</span></div>
          <div className="mt-28 max-w-md"><p className="text-sm font-medium text-blue-200">OPERATIONS CONTROL CENTER</p><h1 className="mt-4 text-4xl font-semibold leading-tight">把复杂的权限运营，<br />变成清晰的日常。</h1><p className="mt-5 max-w-sm text-sm leading-7 text-blue-100">集中管理成员、角色和访问权限，让团队在一个安静可靠的工作区里协作。</p></div>
        </div>
        <div className="flex items-center gap-3 text-sm text-blue-100"><ShieldCheck className="h-5 w-5" /><span>基于角色的安全访问控制</span></div>
      </section>
      <section className="flex items-center justify-center bg-slate-50 px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 lg:hidden"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-sm font-bold text-white">C</span><span className="text-base font-bold text-slate-950">CloudSage</span></div></div>
          <div className="mb-8"><p className="text-sm font-semibold text-blue-700">欢迎回来</p><h2 className="mt-2 text-3xl font-semibold text-slate-950">登录管理后台</h2><p className="mt-2 text-sm leading-6 text-slate-500">使用你的 CloudSage 账号继续工作。</p></div>
          {error && <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          <form className="space-y-5" onSubmit={(event) => void submit(event)}>
            <label className="block space-y-2 text-sm font-medium text-slate-700"><span>邮箱地址</span><span className="relative block"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" required /></span></label>
            <label className="block space-y-2 text-sm font-medium text-slate-700"><span>密码</span><span className="relative block"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" required /></span></label>
            <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-700 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50" disabled={loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{loading ? "正在登录" : "登录"}</button>
          </form>
          <button type="button" onClick={enterDemo} className="mt-5 w-full rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">进入演示工作区</button>
        </div>
      </section>
    </main>
  );
}
