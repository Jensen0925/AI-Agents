"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, Mail, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader, StatusMessage } from "@/components/admin-primitives";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, apiErrorMessage } from "@/lib/api";
import { getCurrentUser, isDemoSession, getSession, saveSession } from "@/lib/auth";

export default function ProfilePage() {
  const storedUser = getCurrentUser();
  const [name, setName] = useState(storedUser?.name ?? "系统管理员");
  const [email, setEmail] = useState(storedUser?.email ?? "admin@cloudsage.local");
  const [roles, setRoles] = useState(storedUser?.roles ?? ["super_admin"]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (isDemoSession()) return; void api.get("/auth/me").then(({ data }) => { setName(data.name); setEmail(data.email); setRoles(data.roles); }).catch((reason) => setError(apiErrorMessage(reason))); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setLoading(true); setError(""); try { if (!isDemoSession()) { const { data } = await api.patch("/users/me", { name }); const session = getSession(); if (session) saveSession({ ...session, user: { ...session.user, name: data.name } }); } setMessage("个人信息已保存"); window.setTimeout(() => setMessage(""), 3200); } catch (reason) { setError(apiErrorMessage(reason)); } finally { setLoading(false); } }
  return <div><PageHeader eyebrow="Account / profile" title="个人信息" description="查看你的账号信息、角色归属和最近的访问状态。" />{message && <StatusMessage message={message} />}{error && <StatusMessage message={error} tone="error" />}<div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]"><section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex items-center gap-4 border-b border-slate-100 px-6 py-5"><Avatar className="h-14 w-14"><AvatarFallback className="text-lg">{name.slice(0, 2)}</AvatarFallback></Avatar><div><h2 className="text-base font-semibold text-slate-900">{name}</h2><p className="mt-1 text-sm text-slate-500">{email}</p></div><Badge variant="success" className="ml-auto"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />活跃</Badge></div><form onSubmit={submit} className="space-y-6 px-6 py-6"><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="profile-name">显示名称</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} className="pl-9" required /></div></div><div className="space-y-2"><Label htmlFor="profile-email">邮箱地址</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="profile-email" value={email} readOnly className="bg-slate-50 pl-9 text-slate-500" /></div><p className="text-xs text-slate-400">邮箱由组织管理员维护</p></div></div><Separator /><div><h3 className="text-sm font-semibold text-slate-800">角色归属</h3><p className="mt-1 text-xs text-slate-500">角色决定你可以访问的管理模块。</p><div className="mt-3 flex flex-wrap gap-2">{roles.map((role) => <Badge key={role} variant="default"><ShieldCheck className="mr-1 h-3.5 w-3.5" />{role}</Badge>)}</div></div><div className="flex justify-end"><Button type="submit" disabled={loading || !name.trim()}>{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{loading ? "保存中" : "保存修改"}</Button></div></form></section><aside className="space-y-5"><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-blue-700" /><h2 className="text-sm font-semibold text-slate-900">安全设置</h2></div><p className="mt-2 text-sm leading-6 text-slate-500">你的账号使用短时访问令牌和可轮换刷新令牌保护。</p><Button variant="outline" className="mt-4 w-full" disabled>修改密码</Button></section><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">访问状态</h2><div className="mt-4 space-y-3 text-sm"><div className="flex items-center justify-between"><span className="text-slate-500">账号状态</span><span className="flex items-center gap-1.5 font-medium text-emerald-700"><Check className="h-4 w-4" />正常</span></div><div className="flex items-center justify-between"><span className="text-slate-500">登录方式</span><span className="font-medium text-slate-700">邮箱密码</span></div></div></section></aside></div></div>;
}
