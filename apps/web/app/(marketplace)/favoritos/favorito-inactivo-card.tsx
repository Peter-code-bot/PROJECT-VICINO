"use client";

import { useState } from "react";
import Image from "next/image";
import { Heart, PackageX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { posterUrl } from "@/lib/video-thumbnail";
import { useFavorites } from "@/components/layout/favorites-provider";

export interface FavoritoInactivoCardProps {
  productoId: string;
  titulo?: string | null;
  imagen?: string | null;
  precio?: number | string | null;
  modoPrecio?: string | null;
  vendedorNombre?: string | null;
  motivo: "eliminado" | "pausado" | "no_disponible";
  onRemove?: (
    productoId: string
  ) => Promise<{ error?: string } | { success: boolean; isFavorite: boolean }>;
}

export function FavoritoInactivoCard({
  productoId,
  titulo,
  imagen,
  precio,
  vendedorNombre,
  motivo,
  onRemove,
}: FavoritoInactivoCardProps) {
  const favorites = useFavorites();
  const [isRemoved, setIsRemoved] = useState(false);
  const [isPending, setIsPending] = useState(false);

  if (isRemoved) {
    return null;
  }

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;

    setIsPending(true);
    // Optimistic removal from provider
    favorites.setFavorite(productoId, false);

    try {
      const action = onRemove ?? (await import("./actions")).removeFavorite;
      const res = await action(productoId);
      if (res && "error" in res && res.error) {
        toast.error(res.error);
        favorites.setFavorite(productoId, true);
      } else {
        setIsRemoved(true);
        toast.success("Favorito retirado");
      }
    } catch {
      toast.error("No se pudo quitar de favoritos. Intenta de nuevo.");
      favorites.setFavorite(productoId, true);
    } finally {
      setIsPending(false);
    }
  }

  const badgeText =
    motivo === "pausado" ? "Pausado" : "No disponible";

  const subtitleText =
    motivo === "pausado"
      ? "Pausado por el vendedor"
      : "Publicación no disponible";

  return (
    <div
      className={cn(
        "group relative block w-full min-w-0 overflow-hidden rounded-2xl product-card-custom transition-all duration-300 opacity-80",
        "border border-border/60 bg-card/60 select-none"
      )}
      role="region"
      aria-label={`${titulo ?? "Publicación"} (${badgeText})`}
    >
      {/* Image container */}
      <div className="relative aspect-square overflow-hidden bg-bg-elev-2">
        {imagen ? (
          <Image
            src={posterUrl(imagen)}
            alt={titulo ?? "Publicación no disponible"}
            fill
            className="object-cover grayscale-[40%] opacity-70"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground/60 p-4 text-center">
            <PackageX className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
            <span className="text-[11px] font-medium leading-tight">No disponible</span>
          </div>
        )}

        {/* Status chip top-left */}
        <div className="absolute top-2 left-2 z-10">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-1 text-[10px] font-heading font-bold uppercase tracking-wider shadow-sm",
              motivo === "pausado"
                ? "bg-[#1E222E]/90 text-white"
                : "bg-danger/90 text-white"
            )}
          >
            {badgeText}
          </span>
        </div>

        {/* Favorite removal button bottom-right */}
        <button
          type="button"
          disabled={isPending}
          aria-label="Quitar de favoritos"
          title="Quitar de favoritos"
          onClick={handleRemove}
          className={cn(
            "absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 z-10",
            "backdrop-blur-md hover:scale-110 active:scale-95 bg-danger text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]"
          )}
        >
          <Heart className="h-4 w-4 fill-current" strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="relative pt-4 px-3.5 pb-3">
        {/* Title */}
        <div className="h-[2.6em] overflow-hidden">
          <h3 className="line-clamp-2 font-heading font-bold text-[14.5px] leading-[1.3] tracking-[-0.3px] text-fg-muted">
            {titulo ?? "Publicación no disponible"}
          </h3>
        </div>

        {/* Seller / Subtitle */}
        <div className="mt-2 flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
          <span className="truncate">
            {vendedorNombre ?? subtitleText}
          </span>
          {motivo === "pausado" && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold shrink-0">
              Pausado
            </span>
          )}
        </div>

        {/* Action hint */}
        <div className="mt-2 text-[10.5px] text-muted-foreground/80 italic">
          Toca el corazón para retirar
        </div>
      </div>
    </div>
  );
}
