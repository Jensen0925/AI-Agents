"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { getCurrentUser, isDemoSession } from "@/lib/auth";

export default function ProfilePage() {
  const [name, setName] = useState(getCurrentUser()?.name ?? "系统管理员");
  const [email, setEmail] = useState(getCurrentUser()?.email ?? "admin@cloudsage.local");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (isDemoSession()) return; void api.get("/users/me").then(({ data }) => { setName(data.name); setEmail(data.email); }).catch((reason) => setError(apiErrorMessage(reason))); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage(""); setError(""); try { if (!isDemoSession()) await api.patch("/users/me", { name }); setMessage("个人信息已更新"); } catch (reason) { setError(apiErrorMessage(reason)); } }
  return <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-xs font-medium uppercase tracking-[0.12em] text-blue-700">Account</p><h2 className="mt-2 text-xl font-semibold text-slate-950">个人信息</h2><p className="mt-2 text-sm text-slate-500">更新你的显示名称，邮箱由管理员账号系统维护。</p>{message && <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}{error && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)}><label className="block space-y-2 text-sm font-medium text-slate-700"><span>姓名</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" required /></label><label className="block space-y-2 text-sm font-medium text-slate-700"><span>邮箱</span><input value={email} readOnly className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 outline-none" /></label><button type="submit" className="rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800">保存修改</button></form></section>;
}
