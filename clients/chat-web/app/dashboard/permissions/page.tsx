"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Lock, Search } from "lucide-react";
import { PageHeader, SearchBar, EmptyState } from "@/components/admin-primitives";
import { Badge } from "@/components/ui/badge";
import { api, apiErrorMessage } from "@/lib/api";
import { isDemoSession } from "@/lib/auth";
import { MOCK_PERMISSIONS, type PermissionRow } from "@/lib/mock-data";

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionRow[]>(MOCK_PERMISSIONS);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (isDemoSession()) return; void api.get<PermissionRow[]>("/permissions").then(({ data }) => setPermissions(data)).catch((reason) => setError(apiErrorMessage(reason))); }, []);
  const filtered = useMemo(() => permissions.filter((permission) => `${permission.module} ${permission.name} ${permission.code}`.toLowerCase().includes(query.toLowerCase().trim())), [permissions, query]);
  const groups = useMemo(() => filtered.reduce<Record<string, PermissionRow[]>>((result, item) => { (result[item.module] ??= []).push(item); return result; }, {}), [filtered]);
  return <div><PageHeader eyebrow="Access / permissions" title="权限列表" description="系统权限是最小可授权单元，按模块组织后分配给角色。" action={<Badge variant="muted"><Lock className="mr-1 h-3.5 w-3.5" />只读目录</Badge>} />{error && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}<section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" /><span className="text-sm font-semibold text-slate-800">权限目录</span><Badge variant="muted">{filtered.length}</Badge></div><SearchBar value={query} onChange={setQuery} placeholder="搜索模块、名称或编码..." /></div>{filtered.length ? <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-2">{Object.entries(groups).map(([module, items]) => <div key={module} className="rounded-md border border-slate-200"><div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-100 text-blue-700"><KeyRound className="h-3.5 w-3.5" /></span><span className="text-sm font-semibold text-slate-800">{module}</span></div><Badge variant="muted">{items.length} 项</Badge></div><div className="divide-y divide-slate-100">{items.map((permission) => <div key={permission.id} className="flex items-start justify-between gap-4 px-4 py-3.5"><div className="min-w-0"><p className="text-sm font-medium text-slate-700">{permission.name}</p><p className="mt-1 break-all font-mono text-xs text-slate-400">{permission.code}</p>{permission.description && <p className="mt-1.5 text-xs leading-5 text-slate-500">{permission.description}</p>}</div><Badge variant="success">可授权</Badge></div>)}</div></div>)}</div> : <EmptyState title="没有匹配的权限" description="换一个关键词试试。" />}</section></div>;
}
