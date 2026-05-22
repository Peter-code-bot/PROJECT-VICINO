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
      <div className="mb-4 flex shadow-[inset_0_-1px_0_0_var(--border)]">
        <button
          onClick={() => setTab("products")}
          className={cn(
            "-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors",
            tab === "products"
              ? "border-[color:var(--brand)] text-[color:var(--brand-hi)]"
              : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          <Grid3X3 className="w-4 h-4" />
          Productos
        </button>
        <button
          onClick={() => setTab("reviews")}
          className={cn(
            "-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors",
            tab === "reviews"
              ? "border-[color:var(--brand)] text-[color:var(--brand-hi)]"
              : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
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
                    <div className="absolute right-1 top-1 rounded bg-[color:var(--trust-gold)] px-1.5 py-0.5 text-[8px] font-bold text-[color:var(--brand-dark)]">
                      PAUSADO
                    </div>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--brand-tint)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
                <span className="text-2xl">📦</span>
              </div>
              <p className="text-sm text-[color:var(--fg-muted)]">Sin productos publicados</p>
              {isVendedor && (
                <Link
                  href="/vender"
                  className="mt-3 inline-block text-sm font-semibold text-[color:var(--brand-hi)] hover:text-[color:var(--brand)]"
                >
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
                <div
                  key={r.id}
                  className="space-y-2 rounded-xl bg-[color:var(--card)] p-4 shadow-[inset_0_0_0_1px_var(--border)]"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
                      {reviewer?.foto ? (
                        <Image src={reviewer.foto} alt="" width={28} height={28} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-[color:var(--fg-muted)]">
                          {reviewer?.nombre?.charAt(0) ?? "?"}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-[color:var(--fg)]">{reviewer?.nombre ?? "Usuario"}</span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="ml-auto text-xs text-[color:var(--fg-dim)]">{formatDate(r.created_at)}</span>
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
                    <p className="text-sm text-[color:var(--fg-muted)]">{r.comentario}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
                      {r.review_type === "buyer_to_seller" ? "Como vendedor" : "Como comprador"}
                    </span>
                    <ReviewProductLink product={reviewedProduct ?? null} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(212,168,83,0.18)] shadow-[inset_0_0_0_1px_rgba(212,168,83,0.30)]">
                <span className="text-2xl">⭐</span>
              </div>
              <p className="text-sm text-[color:var(--fg-muted)]">Sin reseñas aún</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
