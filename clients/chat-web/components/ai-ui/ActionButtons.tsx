"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionButtonsUIResponse, UIAction } from "@/types/ui-types";

interface ActionButtonsProps {
  component: ActionButtonsUIResponse;
  onAction: (action: UIAction) => void;
}

/** 后续操作按钮组，action 字符串由服务端状态机解释。 */
export function ActionButtons({ component, onAction }: ActionButtonsProps) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#16161f] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
      {component.title && <h3 className="text-sm font-semibold text-[#e5e5e5]">{component.title}</h3>}
      <div className="mt-3 flex flex-wrap gap-2">
        {component.buttons.map((button) => (
          <Button
            key={button.action}
            type="button"
            size="sm"
            disabled={button.disabled}
            variant={button.variant === "danger" ? "destructive" : button.variant === "secondary" ? "secondary" : "default"}
            onClick={() => onAction({ type: "button", componentId: component.id, action: button.action })}
            className={cn(
              "text-xs shadow-none",
              button.variant !== "danger" && button.variant !== "secondary" && "bg-[#1e40af] text-white hover:bg-[#1d4ed8]",
            )}
          >
            {button.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
    </section>
  );
}
