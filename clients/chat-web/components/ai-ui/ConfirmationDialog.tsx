"use client";

import { AlertCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConfirmationUIResponse, UIAction } from "@/types/ui-types";

interface ConfirmationDialogProps {
  component: ConfirmationUIResponse;
  onAction: (action: UIAction) => void;
}

/** 行为确认卡片，确认和取消都通过同一 UIAction 协议回传。 */
export function ConfirmationDialog({ component, onAction }: ConfirmationDialogProps) {
  const summary = Array.isArray(component.summary) ? component.summary : [component.summary];

  return (
    <section
      role="dialog"
      aria-label={component.title}
      className="rounded-2xl border border-amber-300/20 bg-[#1c1a17] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#f2ede4]">{component.title}</h3>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-[#b8afa2]">
            {summary.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300/80" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            onAction({
              type: "confirmation",
              componentId: component.id,
              confirmed: false,
              action: component.cancelAction,
            })
          }
          className="text-xs text-[#aaa19a] hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
          {component.cancelLabel ?? "取消"}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onAction({
              type: "confirmation",
              componentId: component.id,
              confirmed: true,
              action: component.confirmAction,
            })
          }
          className="bg-[#1e40af] text-xs text-white shadow-none hover:bg-[#1d4ed8]"
        >
          <Check className="h-3.5 w-3.5" />
          {component.confirmLabel ?? "确认"}
        </Button>
      </div>
    </section>
  );
}
