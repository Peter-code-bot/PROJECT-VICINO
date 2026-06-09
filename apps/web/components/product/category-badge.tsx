import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
  name: string;
  isPrimary?: boolean;
  className?: string;
}

/**
 * MP#08 #5c-4: chip de categoria para ProductCard. Espejo visual de
 * NegociablePill (rounded-md px-1.5 py-0.5 text-[10px] uppercase) pero
 * con tone variable segun isPrimary: primary = brand-tint-strong + brand-hi
 * (misma paleta que Negociable), secondary = card-2 muted (suave para que
 * la primary destaque).
 *
 * Visual only en 5c-4 (D6 firmado): el badge NO es clickeable. Click ->
 * /buscar?category= sera item aparte para evitar collision con el card
 * href del padre `<Link>` y el stopPropagation que requiere.
 */
export function CategoryBadge({ name, isPrimary, className }: CategoryBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[9.5px] font-heading font-bold uppercase tracking-[0.6px]",
        "bg-[#E8D7AE] text-[#5B4A22]",
        className,
      )}
    >
      {name}
    </span>
  );
}
