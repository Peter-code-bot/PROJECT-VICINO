import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "destructive" | "outline";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default:
    "bg-muted text-foreground border border-border",
  success:
    "bg-emerald-trust/15 text-emerald-trust border border-emerald-trust/30",
  warning:
    "bg-gold/15 text-gold border border-gold/30",
  destructive:
    "bg-destructive/15 text-destructive border border-destructive/30",
  outline:
    "bg-transparent text-muted-foreground border border-border",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";
