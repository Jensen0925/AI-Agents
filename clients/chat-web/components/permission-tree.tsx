"use client";

import { useMemo } from "react";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { PermissionRow } from "@/lib/mock-data";

interface PermissionTreeProps {
  permissions: PermissionRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function PermissionTree({ permissions, selected, onChange }: PermissionTreeProps) {
  const groups = useMemo(() => permissions.reduce<Record<string, PermissionRow[]>>((result, item) => {
    (result[item.module] ??= []).push(item);
    return result;
  }, {}), [permissions]);

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    onChange([...next]);
  }

  function toggleModule(items: PermissionRow[], checked: boolean) {
    const next = new Set(selected);
    items.forEach((item) => checked ? next.add(item.id) : next.delete(item.id));
    onChange([...next]);
  }

  return (
    <div className="space-y-3" aria-label="按模块分组的权限树">
      {Object.entries(groups).map(([module, items]) => {
        const selectedCount = items.filter((item) => selected.includes(item.id)).length;
        const allSelected = selectedCount === items.length;
        return (
          <div key={module} className="overflow-hidden rounded-md border border-slate-200">
            <div className="flex items-center gap-3 bg-slate-50 px-4 py-3">
              <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleModule(items, checked === true)} aria-label={`选择全部${module}权限`} />
              <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span className="flex-1 text-sm font-semibold text-slate-800">{module}</span>
              <span className="text-xs text-slate-500">{selectedCount}/{items.length}</span>
            </div>
            <div className="grid gap-1 border-t border-slate-200 p-2 sm:grid-cols-2">
              {items.map((item) => {
                const active = selected.includes(item.id);
                return (
                  <label key={item.id} className={cn("flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-slate-50", active && "bg-blue-50/70")}>
                    <Checkbox checked={active} onCheckedChange={(checked) => toggle(item.id, checked === true)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><span>{item.name}</span>{active && <Check className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />}</span>
                      <span className="mt-0.5 block break-all text-xs text-slate-400">{item.code}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {!permissions.length && <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><ShieldCheck className="h-4 w-4" />暂无可分配权限</div>}
    </div>
  );
}
