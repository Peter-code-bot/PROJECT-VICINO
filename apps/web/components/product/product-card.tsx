"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { NegociablePill } from "@/components/product/negociable-pill";
import { CategoryBadge } from "@/components/product/category-badge";
import type { ProductCardCategory, TrustLevel } from "@vicino/shared";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  id: string;
  titulo: string;
  precio: number;
  imagen: string | null;
  categoria: string;
  slug: string;
  vendedor: {
    nombre: string;
    trust_level: TrustLevel;
  };
  rating: number;
  reviewsCount: number;
  isFavorite?: boolean;
  precioNegociable?: boolean;
  // MP#08 #5c-4: array opcional normalizado primary-first via
  // normalizeCardCategories(product.product_categories) en el caller.
  // Default [] mantiene la card identica para callers no migrados.
  categories?: ProductCardCategory[];
}

export function ProductCard({
  id,
  titulo,
  precio,
  imagen,
  categoria,
  slug,
  vendedor,
  rating,
  reviewsCount,
  isFavorite: initialFavorite = false,
  precioNegociable,
  categories = [],
}: ProductCardProps) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);

  const { mutate: toggleFav, isPending } = useOptimisticMutation(
    toggleFavorite,
    {
      onMutate: () => {
        const previous = isFavorite;
        setIsFavorite(!previous);
        return () => setIsFavorite(previous);
      },
      onSuccess: (result) => {
        if (
          result &&
          typeof result === "object" &&
          "isFavorite" in result &&
          typeof result.isFavorite === "boolean"
        ) {
          setIsFavorite(result.isFavorite);
        }
      },
    },
  );

  return (
    <Link
      // MP#08 #4 Fase 1B: href deriva el segmento de categoria de la primary
      // del pivote (categories ya viene normalized primary-first desde el
      // caller post-5c-4). Fallback al prop categoria TEXT si categories
      // esta vacio (caller no migrado o edge sin pivote). Cuando 1C dropee
      // el writer espejo este fallback se vuelve solo defense in depth.
      // Keystone: este cambio cubre 4 surfaces (buscar, favoritos, home
      // Recientes + per-cat carousels) sin tocar a los callers.
      href={`/${categories[0]?.slug ?? categoria}/${slug}`}
      id={`product-${slug}`}
      className={cn(
        "group block w-full min-w-0 overflow-hidden rounded-xl bg-card transition-all duration-300",
        "shadow-[inset_0_0_0_1px_var(--border)]",
        "hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong),var(--shadow-glow)]"
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-bg-elev-2">
        {imagen ? (
          <Image
            src={imagen}
            alt={titulo}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <span className="mb-1 block text-3xl">📷</span>
              <span className="text-xs text-fg-dim">Sin imagen</span>
            </div>
          </div>
        )}

        {/* Price chip — refinada variant, top-right */}
        <div className="pointer-events-none absolute top-2 right-2">
          <div
            className={cn(
              "inline-flex items-center rounded-md px-2 py-1",
              "bg-white/92 text-brand-dark",
              "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
            )}
          >
            <PriceDisplay
              amount={precio}
              size="sm"
              className="font-heading font-bold text-brand-dark"
            />
          </div>
        </div>

        {/* Negociable badge — top-left, brand tone */}
        {precioNegociable && (
          <div className="absolute top-2 left-2">
            <NegociablePill />
          </div>
        )}

        {/* Favorite — bottom-right floating */}
        <button
          type="button"
          disabled={isPending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void toggleFav(id);
          }}
          aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
          className={cn(
            "absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
            "backdrop-blur-md hover:scale-110 active:scale-95",
            isFavorite
              ? "bg-danger text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]"
              : "bg-black/40 text-white hover:bg-black/55"
          )}
        >
          <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-1.5 p-3">
        <h3 className="line-clamp-2 font-heading text-[14px] font-semibold leading-snug text-fg transition-colors duration-200 group-hover:text-brand-hi">
          {titulo}
        </h3>

        {/* MP#08 #5c-4: badge row — primary categoria + "+N" si hay secundarias.
            Cero render si categories esta vacio (default callers no migrados).
            Layout Option B (D4): content row debajo del titulo, sin colision
            con overlays (price/Negociable/favorite siguen en sus esquinas). */}
        {categories.length > 0 && categories[0] && (
          <div className="flex items-center gap-1 flex-wrap">
            <CategoryBadge name={categories[0].nombre} isPrimary />
            {categories.length > 1 && (
              <span className="text-[10px] font-semibold text-fg-muted">
                +{categories.length - 1}
              </span>
            )}
          </div>
        )}

        {/* Seller row: trust dot inline + name + badge */}
        <div className="flex items-center gap-1.5">
          {vendedor.trust_level !== "nuevo" && (
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--trust-emerald)]"
              aria-hidden
            />
          )}
          <span className="truncate text-xs text-fg-muted">
            {vendedor.nombre}
          </span>
          <SellerBadge level={vendedor.trust_level} showLabel={false} size="sm" />
        </div>

        {/* Rating */}
        {rating > 0 && (
          <RatingStars rating={rating} count={reviewsCount} size="sm" />
        )}
      </div>
    </Link>
  );
}
