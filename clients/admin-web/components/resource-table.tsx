"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { isDemoSession } from "@/lib/auth";

export interface ResourceRow { id: string; [key: string]: unknown; }
interface Column { key: string; label: string; render?: (row: ResourceRow) => React.ReactNode; }
interface ResourceTableProps { title: string; description: string; endpoint: string; columns: Column[]; demoRows: ResourceRow[]; }

export function ResourceTable({ title, description, endpoint, columns, demoRows }: ResourceTableProps) {
  // 初始态必须是空：把 demoRows 当初始态会让接口失败时假数据继续以真实数据的样子展示。
  // 演示会话是唯一使用 demoRows 的场景，由 isDemoSession() 显式判定。
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isDemoSession()) {
      setRows(demoRows);
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void api.get(endpoint, { params: endpoint === "/users" ? { pageSize: 100 } : undefined }).then(({ data }) => {
      if (!active) return;
      setRows(Array.isArray(data) ? data : data.items ?? []);
    }).catch((reason) => {
      if (!active) return;
      setError(apiErrorMessage(reason));
      setRows([]);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [endpoint, demoRows]);

  const filtered = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase().trim())), [rows, query]);
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-blue-700">Access control</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><label className="relative block w-full sm:w-64"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`搜索${title}`} placeholder="搜索..." className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label></div></div>{error && <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs font-medium text-slate-500"><tr>{columns.map((column) => <th key={column.key} className="px-5 py-3">{column.label}</th>)}</tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">{columns.map((column) => <td key={column.key} className="px-5 py-3 text-slate-700">{column.render ? column.render(row) : String(row[column.key] ?? "-")}</td>)}</tr>)}</tbody></table></div>{loading && <div className="px-5 py-14 text-center text-sm text-slate-500">正在加载…</div>}{!loading && filtered.length === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">{error ? "数据加载失败" : "没有匹配的数据"}</div>}<div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">共 {filtered.length} 条记录</div></section>;
}
