import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-blue-50 text-blue-700",
      success: "border-transparent bg-emerald-50 text-emerald-700",
      warning: "border-transparent bg-amber-50 text-amber-700",
      danger: "border-transparent bg-red-50 text-red-700",
      muted: "border-slate-200 bg-slate-50 text-slate-600",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
