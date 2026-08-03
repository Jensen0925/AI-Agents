import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder = "搜索名称、邮箱或编码..." }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} /></div>;
}

export function FilterButton({ children = "筛选" }: { children?: ReactNode }) {
  return <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{children}</Button>;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><p className="text-xs text-slate-500">第 {page} / {totalPages} 页</p><div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="上一页" title="上一页"><ChevronLeft className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="下一页" title="下一页"><ChevronRight className="h-4 w-4" /></Button></div></div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="px-6 py-16 text-center"><p className="text-sm font-semibold text-slate-700">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

export function StatusMessage({ message, tone = "success" }: { message: string; tone?: "success" | "error" }) {
  return <div role="status" className={`mb-4 rounded-md border px-4 py-3 text-sm ${tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message}</div>;
}
import type { ReactNode } from "react";
