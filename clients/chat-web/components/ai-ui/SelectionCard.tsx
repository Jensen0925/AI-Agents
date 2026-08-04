"use client";

import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SelectionUIResponse, UIAction } from "@/types/ui-types";

interface SelectionCardProps {
  component: SelectionUIResponse;
  onAction: (action: UIAction) => void;
}

/**
 * 需求类型选择组件。
 * 单选时点击选项立即回传，多选时先维护本地状态，再由提交按钮统一回传。
 */
export function SelectionCard({ component, onAction }: SelectionCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const multiple = component.multiple === true;

  function selectOption(value: string) {
    if (multiple) {
      setSelected((current) =>
        current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value],
      );
      return;
    }

    onAction({
      type: "selection",
      componentId: component.id,
      value,
    });
  }

  function submitSelection() {
    if (component.required && selected.length === 0) return;
    onAction({
      type: "selection",
      componentId: component.id,
      value: selected,
    });
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>
          {component.description && (
            <p className="mt-1.5 text-xs leading-5 text-[#888894]">{component.description}</p>
          )}
        </div>
        {multiple && (
          <span className="rounded-full bg-blue-400/10 px-2 py-1 text-[10px] text-blue-200">
            可多选
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {component.options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => selectOption(option.value)}
              className={cn(
                "group flex min-h-16 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                option.disabled
                  ? "cursor-not-allowed border-white/[0.05] bg-white/[0.02] opacity-50"
                  : isSelected
                    ? "border-blue-400/60 bg-blue-500/10"
                    : "border-white/[0.08] bg-[#111118] hover:border-blue-400/35 hover:bg-blue-500/[0.06]",
              )}
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#dfdfe7]">{option.label}</span>
                {option.description && (
                  <span className="mt-1 block text-[11px] leading-4 text-[#777783]">
                    {option.description}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                  isSelected
                    ? "border-blue-300 bg-blue-500 text-white"
                    : "border-white/[0.14] text-transparent group-hover:border-blue-300/60",
                )}
              >
                {isSelected ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>

      {multiple && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#777783]">
            {selected.length > 0 ? `已选择 ${selected.length} 项` : "请选择至少一项"}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={component.required === true && selected.length === 0}
            onClick={submitSelection}
            className="bg-[#1e40af] text-xs text-white shadow-none hover:bg-[#1d4ed8]"
          >
            {component.submitLabel ?? "继续"}
          </Button>
        </div>
      )}
    </section>
  );
}
