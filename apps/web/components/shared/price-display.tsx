import { formatPrice } from "@vicino/shared";
import { cn } from "@/lib/utils";

interface PriceDisplayProps {
  amount: number | string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Texto a mostrar cuando no hay precio (ej. "Consultar"). Sin esto el
   *  componente no pinta nada. */
  fallback?: string;
}

export function PriceDisplay({ amount, size = "md", className, fallback }: PriceDisplayProps) {
  const formatted = formatPrice(amount);
  if (formatted === null && fallback === undefined) return null;
  const text = formatted ?? fallback;
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
      {text}
    </span>
  );
}
