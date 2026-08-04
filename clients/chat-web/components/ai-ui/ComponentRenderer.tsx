"use client";

import { cn } from "@/lib/utils";
import { ActionButtons } from "./ActionButtons";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { DataTable } from "./DataTable";
import { DynamicForm } from "./DynamicForm";
import { InfoCard } from "./InfoCard";
import { SelectionCard } from "./SelectionCard";
import { StepsProgress } from "./StepsProgress";
import type { UIAction, UIResponse } from "@/types/ui-types";

interface ComponentRendererProps {
  component: UIResponse;
  onAction: (action: UIAction) => void;
  className?: string;
}

/** 根据 UIResponse.type 选择对应的交互组件，保持协议与展示层解耦。 */
export function ComponentRenderer({ component, onAction, className }: ComponentRendererProps) {
  const rendered = (() => {
    switch (component.type) {
      case "text":
        return (
          <div className="rounded-2xl border border-white/[0.08] bg-[#16161f] px-4 py-3 text-sm leading-6 text-[#c9c9d2]">
            <p className="whitespace-pre-wrap break-words">{component.content}</p>
          </div>
        );
      case "selection":
        return <SelectionCard component={component} onAction={onAction} />;
      case "form":
        return <DynamicForm component={component} onAction={onAction} />;
      case "confirmation":
        return <ConfirmationDialog component={component} onAction={onAction} />;
      case "card":
        return <InfoCard component={component} onAction={onAction} />;
      case "steps":
        return <StepsProgress component={component} />;
      case "table":
        return <DataTable component={component} />;
      case "action_buttons":
        return <ActionButtons component={component} onAction={onAction} />;
      default:
        return null;
    }
  })();

  if (!rendered) return null;
  return <div className={cn("w-full max-w-[780px]", className)}>{rendered}</div>;
}
