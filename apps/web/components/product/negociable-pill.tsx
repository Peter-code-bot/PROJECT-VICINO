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
    <div className={cn("absolute top-0 left-0 w-[92px] h-[92px] overflow-hidden pointer-events-none z-10", className)}>
      <div
        className={cn(
          "absolute top-[14px] -left-[28px] w-[110px] py-1 text-center -rotate-45",
          "bg-gradient-to-r from-[#2E8773] to-[#3FA68B]",
          "text-white font-heading text-[8.5px] font-extrabold tracking-[1.2px] uppercase",
          "shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        )}
      >
        Negociable
      </div>
    </div>
  );
}
