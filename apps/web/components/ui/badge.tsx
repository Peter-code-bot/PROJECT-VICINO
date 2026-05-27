import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "outline" | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default:
    "bg-muted text-foreground",
  success:
    "bg-emerald-trust/15 text-emerald-trust ring-1 ring-inset ring-emerald-trust/30",
  outline:
    "border border-border text-foreground",
  muted:
    "bg-muted text-muted-foreground",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
