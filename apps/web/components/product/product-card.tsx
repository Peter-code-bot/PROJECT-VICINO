"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import type { TrustLevel } from "@vicino/shared";
import { Heart } from "lucide-react";

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
}: ProductCardProps) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();
  return (
    <Link
      href={`/${categoria}/${slug}`}
      className="group block w-full min-w-0 rounded-2xl bg-card border border-border/40 overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/15"
      id={`product-${slug}`}
    >
      <div className="aspect-square relative bg-card dark:bg-neutral-800 overflow-hidden">
        {imagen ? (
          <Image
            src={imagen}
            alt={titulo}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <span className="text-3xl block mb-1">📷</span>
              <span className="text-xs text-muted-foreground">Sin imagen</span>
            </div>
          </div>
        )}

        {/* Price Badge — glassmorphism bottom-left */}
        <div className="absolute bottom-2 left-2">
          <div className="px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 text-white">
            <PriceDisplay amount={precio} size="sm" className="font-heading font-bold text-white" />
          </div>
        </div>

        {/* Badge — top-left */}
        {precioNegociable && (
          <div className="absolute top-2 left-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white">
              Negociable
            </span>
          </div>
        )}

        {/* Favorite Button — top-right translucent */}
        <button
          className={`absolute top-2 right-2 w-8 h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 border border-white/20 ${isFavorite ? "bg-red-500/80 text-white" : "bg-black/40 hover:bg-black/60"}`}
          disabled={isPending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsFavorite(!isFavorite);
            startTransition(async () => {
              const result = await toggleFavorite(id);
              if (result.isFavorite !== undefined) setIsFavorite(result.isFavorite);
            });
          }}
          aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
        >
          <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : "text-white"}`} />
        </button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-1.5">
        <h3 className="text-sm font-medium line-clamp-2 leading-snug group-hover:text-primary transition-colors duration-200">
          {titulo}
        </h3>

        {/* Seller info */}
        <div className="flex items-center gap-1.5">
          {vendedor.trust_level !== "nuevo" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-trust flex-shrink-0" />
          )}
          <span className="text-xs text-muted-foreground truncate">
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
