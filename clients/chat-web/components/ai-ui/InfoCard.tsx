"use client";

import { ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CardUIResponse, UIAction } from "@/types/ui-types";

interface InfoCardProps {
  component: CardUIResponse;
  onAction: (action: UIAction) => void;
}

function formatValue(value: CardUIResponse["fields"][number]["value"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

/** 展示需求详情、检索结果等结构化信息。 */
export function InfoCard({ component, onAction }: InfoCardProps) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>
          {component.subtitle && <p className="mt-1 text-xs text-[#777783]">{component.subtitle}</p>}
        </div>
        {component.status && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-300">
            {component.status === "已完成" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <CircleAlert className="h-3 w-3" />
            )}
            {component.status}
          </span>
        )}
      </div>

      <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#111118]">
        {component.fields.map((field, index) => (
          <div
            key={field.key ?? `${field.label}-${index}`}
            className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 px-3.5 py-2.5 text-xs"
          >
            <dt className="text-[#777783]">{field.label}</dt>
            <dd
              className={cn(
                "break-words text-right",
                field.value == null ? "text-[#666672]" : "text-[#d8d8e0]",
              )}
            >
              {formatValue(field.value)}
            </dd>
          </div>
        ))}
      </dl>

      {component.actions && component.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {component.actions.map((action) => (
            <Button
              key={action.action}
              type="button"
              size="sm"
              variant={
                action.variant === "danger"
                  ? "destructive"
                  : action.variant === "secondary"
                    ? "secondary"
                    : "default"
              }
              disabled={action.disabled}
              onClick={() =>
                onAction({ type: "button", componentId: component.id, action: action.action })
              }
              className={cn(
                "text-xs shadow-none",
                action.variant !== "danger" &&
                  action.variant !== "secondary" &&
                  "bg-[#1e40af] text-white hover:bg-[#1d4ed8]",
              )}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
