import { formatPrice } from "@vicino/shared";
import { cn } from "@/lib/utils";

interface PriceDisplayProps {
  amount: number | string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PriceDisplay({ amount, size = "md", className }: PriceDisplayProps) {
  const formatted = formatPrice(amount);
  if (formatted === null) return null;
  return (
    <span
      className={cn(
        "font-heading font-bold tabular-nums",
        size === "sm" && "text-sm",
        size === "md" && "text-base",
        size === "lg" && "text-xl",
        className
      )}
    >
      {formatted}
    </span>
  );
}
