import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/10 text-primary",
      success: "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
      warning: "border-transparent bg-amber-500/12 text-amber-600 dark:text-amber-400",
      danger: "border-transparent bg-destructive/10 text-destructive",
      muted: "border-border bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
