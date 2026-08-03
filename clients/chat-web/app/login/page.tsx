"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, LoaderCircle, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiErrorMessage } from "@/lib/api";
import { saveDemoSession, saveSession, type Session } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@cloudsage.local");
  const [password, setPassword] = useState("Cloudsage@123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    try { const { data } = await api.post<Session>("/auth/login", { email, password }); saveSession(data); router.replace("/chat"); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  }

  function enterDemo() { saveDemoSession(); router.replace("/chat"); }

  return <main className="grid min-h-screen lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
    <section className="relative hidden overflow-hidden bg-blue-800 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-20"><div><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-sm font-bold text-blue-800">C</span><span className="text-lg font-bold">CloudSage</span></div><div className="mt-28 max-w-md"><p className="text-sm font-medium text-blue-200">OPERATIONS CONTROL CENTER</p><h1 className="mt-4 text-4xl font-semibold leading-tight">把复杂的权限运营，<br />变成清晰的日常。</h1><p className="mt-5 max-w-sm text-sm leading-7 text-blue-100">集中管理成员、角色和访问权限，让团队在一个安静可靠的工作区里协作。</p></div></div><div className="flex items-center gap-3 text-sm text-blue-100"><ShieldCheck className="h-5 w-5" /><span>基于角色的安全访问控制</span></div></section>
    <section className="flex items-center justify-center bg-slate-50 px-5 py-10 sm:px-10"><div className="w-full max-w-[420px]"><div className="mb-10 lg:hidden"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-sm font-bold text-white">C</span><span className="text-base font-bold text-slate-950">CloudSage</span></div></div><div className="mb-8"><p className="text-sm font-semibold text-blue-700">欢迎回来</p><h2 className="mt-2 text-3xl font-semibold text-slate-950">登录管理后台</h2><p className="mt-2 text-sm leading-6 text-slate-500">使用你的 CloudSage 账号继续工作。</p></div>{error && <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}<form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label htmlFor="email">邮箱地址</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="pl-9" required /></div></div><div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password">密码</Label><button type="button" className="text-xs font-medium text-blue-700 hover:underline">忘记密码？</button></div><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="pl-9" required /></div></div><Button type="submit" className="h-11 w-full" disabled={loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{loading ? "正在登录" : "登录"}</Button></form><div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs text-slate-400">或</span><div className="h-px flex-1 bg-slate-200" /></div><Button type="button" variant="secondary" className="w-full" onClick={enterDemo}><CheckCircle2 className="h-4 w-4 text-emerald-600" />进入演示工作区</Button><p className="mt-8 text-center text-xs leading-5 text-slate-400">演示模式使用本地数据；生产环境请使用组织账号登录。</p></div></section>
  </main>;
}
