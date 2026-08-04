"use client";

import { Check, Circle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepsUIResponse } from "@/types/ui-types";

interface StepsProgressProps {
  component: StepsUIResponse;
}

/** 需求分析阶段进度展示，状态完全由服务端返回。 */
export function StepsProgress({ component }: StepsProgressProps) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      {component.title && <h3 className="text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>}
      <ol className="mt-4 space-y-3">
        {component.steps.map((step, index) => {
          const status = step.status ?? (index < component.current ? "completed" : index === component.current ? "current" : "pending");
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border",
                    status === "completed" && "border-emerald-300/50 bg-emerald-400/10 text-emerald-300",
                    status === "current" && "border-blue-300/60 bg-blue-500/15 text-blue-200",
                    status === "error" && "border-red-300/50 bg-red-400/10 text-red-300",
                    status === "pending" && "border-white/[0.12] bg-white/[0.03] text-[#666672]",
                  )}
                >
                  {status === "completed" ? <Check className="h-3.5 w-3.5" /> : status === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "error" ? <X className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
                </span>
                {index < component.steps.length - 1 && <span className="mt-1 h-full min-h-4 w-px bg-white/[0.08]" />}
              </div>
              <div className="min-w-0 pb-1">
                <p className={cn("text-xs font-medium", status === "pending" ? "text-[#777783]" : "text-[#d7d7df]")}>{step.label}</p>
                {step.description && <p className="mt-1 text-[11px] leading-5 text-[#777783]">{step.description}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
