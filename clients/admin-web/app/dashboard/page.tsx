"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, KeyRound, ShieldCheck, Users } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { isDemoSession } from "@/lib/auth";

interface CountState { users: number; roles: number; permissions: number; }

export default function DashboardPage() {
  const [counts, setCounts] = useState<CountState>({ users: 0, roles: 0, permissions: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    if (isDemoSession()) {
      setCounts({ users: 1, roles: 1, permissions: 12 });
      return;
    }
    void Promise.all([api.get("/users", { params: { pageSize: 1 } }), api.get("/roles"), api.get("/permissions")]).then(([users, roles, permissions]) => setCounts({ users: users.data.total ?? users.data.items?.length ?? 0, roles: roles.data.length, permissions: permissions.data.length })).catch((reason) => setError(apiErrorMessage(reason)));
  }, []);
  const cards = [{ label: "组织成员", value: counts.users, href: "/dashboard/users", icon: Users, tone: "bg-blue-50 text-blue-700" }, { label: "角色", value: counts.roles, href: "/dashboard/roles", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" }, { label: "权限", value: counts.permissions, href: "/dashboard/permissions", icon: KeyRound, tone: "bg-violet-50 text-violet-700" }];
  return <div><div className="mb-7"><p className="text-xs font-medium uppercase tracking-[0.12em] text-blue-700">Overview</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">权限运营工作台</h2><p className="mt-2 text-sm text-slate-500">查看 CloudSage 组织访问控制的实时概览。</p></div>{error && <p className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<div className="grid gap-4 md:grid-cols-3">{cards.map(({ label, value, href, icon: Icon, tone }) => <Link key={href} href={href} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/30"><div className="flex items-start justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></span><ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-blue-600" /></div><p className="mt-5 text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{value}</p></Link>)}</div><section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-slate-900">快捷入口</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><Link href="/dashboard/users" className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50/40">管理组织成员<span className="mt-1 block text-xs text-slate-400">创建账号、调整状态和角色</span></Link><Link href="http://localhost:3002/chat" className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50/40">打开 AI 工作区<span className="mt-1 block text-xs text-slate-400">进入需求分析与知识库</span></Link></div></section></div>;
}
