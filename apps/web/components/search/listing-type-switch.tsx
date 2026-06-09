"use client";

import { cn } from "@/lib/utils";

export type ListingType = "producto" | "servicio";

interface ListingTypeSwitchProps {
  value?: ListingType | null;
  onChange: (type: ListingType | null) => void;
  className?: string;
}

export function ListingTypeSwitch({
  value,
  onChange,
  className,
}: ListingTypeSwitchProps) {
  function toggle(type: ListingType) {
    onChange(value === type ? null : type);
  }

  return (
    <div
      role="tablist"
      aria-label="Filtrar por tipo de publicación"
      className={cn(
        "inline-flex product-card-custom rounded-full p-1",
        className
      )}
    >
      <button
        role="tab"
        aria-selected={value === "producto"}
        onClick={() => toggle("producto")}
        className={cn(
          "px-6 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-all",
          value === "producto"
            ? "category-tile-selected shadow-sm"
            : "product-card-muted hover:text-[color:var(--fg)]"
        )}
      >
        Productos
      </button>
      <button
        role="tab"
        aria-selected={value === "servicio"}
        onClick={() => toggle("servicio")}
        className={cn(
          "px-6 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-all",
          value === "servicio"
            ? "category-tile-selected shadow-sm"
            : "product-card-muted hover:text-[color:var(--fg)]"
        )}
      >
        Servicios
      </button>
    </div>
  );
}
