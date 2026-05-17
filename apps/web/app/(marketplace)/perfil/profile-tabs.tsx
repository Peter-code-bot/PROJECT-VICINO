"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { formatPrice, formatDate } from "@vicino/shared";
import { Grid3X3, Star } from "lucide-react";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";

interface ProfileTabsProps {
  products: Array<{
    id: string;
    titulo: string;
    precio: number;
    imagen_principal: string | null;
    categoria: string;
    slug: string;
    estatus: string;
    ventas_count: number;
  }>;
  reviewsAsSeller: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    review_type: string;
    reviewer_id?: string;
    profiles: { nombre: string; foto: string | null } | { nombre: string; foto: string | null }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }[]
      | null;
  }>;
  reviewsAsBuyer: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    review_type: string;
    reviewer_id?: string;
    profiles: { nombre: string; foto: string | null } | { nombre: string; foto: string | null }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }[]
      | null;
  }>;
  isVendedor: boolean;
  /** Id del usuario autenticado. Se usa para esconder el botón "Reportar" en
   *  reseñas escritas por el propio usuario. */
  currentUserId?: string | null;
}

export function ProfileTabs({ products, reviewsAsSeller, reviewsAsBuyer, isVendedor, currentUserId }: ProfileTabsProps) {
  const [tab, setTab] = useState<"products" | "reviews">("products");

  const allReviews = [...reviewsAsSeller, ...reviewsAsBuyer];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border/40 mb-4">
        <button
          onClick={() => setTab("products")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "products"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Grid3X3 className="w-4 h-4" />
          Productos
        </button>
        <button
          onClick={() => setTab("reviews")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "reviews"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Star className="w-4 h-4" />
          Reseñas ({allReviews.length})
        </button>
      </div>

      {/* Products grid */}
      {tab === "products" && (
        <div>
          {products.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/${p.categoria}/${p.slug}`}
                  className="relative aspect-square bg-card dark:bg-neutral-800 overflow-hidden rounded-lg group"
                >
                  {p.imagen_principal ? (
                    <Image
                      src={p.imagen_principal}
                      alt={p.titulo}
                      fill
                      className="object-cover group-hover:opacity-80 transition-opacity"
                      sizes="33vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">📷</div>
                  )}
                  {/* Price overlay on hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white font-heading font-bold text-sm">
                      {formatPrice(Number(p.precio))}
                    </span>
                  </div>
                  {p.estatus === "pausado" && (
                    <div className="absolute top-1 right-1 bg-amber-500 text-white text-[8px] px-1.5 py-0.5 rounded font-bold">
                      PAUSADO
                    </div>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">📦</p>
              <p className="text-sm text-muted-foreground">Sin productos publicados</p>
              {isVendedor && (
                <Link href="/vender" className="text-sm text-primary font-medium hover:underline mt-2 inline-block">
                  Publicar mi primer producto →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reviews */}
      {tab === "reviews" && (
        <div className="space-y-3">
          {allReviews.length > 0 ? (
            allReviews.map((r) => {
              const reviewer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const reviewedProduct = Array.isArray(r.products_services)
                ? r.products_services[0]
                : r.products_services;
              const isOwnReview = currentUserId != null && r.reviewer_id === currentUserId;
              return (
                <div key={r.id} className="rounded-xl border border-border/40 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                      {reviewer?.foto ? (
                        <Image src={reviewer.foto} alt="" width={28} height={28} className="object-cover w-full h-full" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold">
                          {reviewer?.nombre?.charAt(0) ?? "?"}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-medium">{reviewer?.nombre ?? "Usuario"}</span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="text-xs text-muted-foreground ml-auto">{formatDate(r.created_at)}</span>
                    {currentUserId && !isOwnReview && (
                      <ReportMenuButton
                        targetType="review"
                        targetId={r.id}
                        targetLabel={r.comentario ? r.comentario.slice(0, 60) : `Reseña de ${reviewer?.nombre ?? "usuario"}`}
                        iconSize={14}
                        ariaLabel="Reportar reseña"
                      />
                    )}
                  </div>
                  {r.comentario && (
                    <p className="text-sm text-muted-foreground">{r.comentario}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide shrink-0">
                      {r.review_type === "buyer_to_seller" ? "Como vendedor" : "Como comprador"}
                    </span>
                    <ReviewProductLink product={reviewedProduct ?? null} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">⭐</p>
              <p className="text-sm text-muted-foreground">Sin reseñas aún</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
