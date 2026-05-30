import { cn } from "@/lib/utils";

interface NegociablePillProps {
  className?: string;
}

/**
 * "Negociable" badge surfaced when products_services.precio_negociable is true.
 * Extracted from the JSX that already lived inline in ProductCard so the same
 * visual is reused across the listing card (top-left overlay) and the product
 * detail page (inline next to the price). MP#08 #2 Parte 2b.
 */
export function NegociablePill({ className }: NegociablePillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        "bg-brand-tint-strong text-brand-hi",
        "shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]",
        className,
      )}
    >
      Negociable
    </span>
  );
}
