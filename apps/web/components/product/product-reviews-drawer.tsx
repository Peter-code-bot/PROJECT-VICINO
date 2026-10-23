"use client";

import { publicProfileName } from "@vicino/shared";
import { useId, useRef, useState } from "react";
import { MessageCircle, X, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { loadSellerReviews } from "@/app/(marketplace)/reviews/actions";
import type { ProductDetailReview } from "./types";

export type DrawerReview = ProductDetailReview;

interface ProductReviewsDrawerProps {
  open: boolean;
  onClose: () => void;
  reviews: DrawerReview[];
  averageRating: number;
  reviewsCount: number;
  sellerId?: string;
  sellerName: string;
  sellerAvatar: string | null;
  currentUserId: string | null;
  currentProductId: string;
  side?: "bottom" | "right";
}

function VerifiedReviewLabel() {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <span className="relative inline-flex">
    <button type="button" aria-describedby={id} onFocus={() => setExpanded(true)} onBlur={() => setExpanded(false)}
      onClick={() => setExpanded(true)}
      className="inline-flex min-h-12 items-center gap-1 rounded-full bg-brand-tint px-2 text-xs font-medium text-emerald-trust focus-visible:ring-2 focus-visible:ring-brand">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />Reseña verificada
    </button>
    <span id={id} role="tooltip" hidden={!expanded} className="absolute left-0 top-full z-10 w-52 rounded-lg border border-border bg-card p-2 text-xs text-fg shadow-md">
      Vinculada a una compra completada en VICINO.
    </span>
  </span>;
}

export function ProductReviewsDrawer(props: ProductReviewsDrawerProps) {
  return props.open ? <ReviewsSession {...props} /> : null;
}

function ReviewsSession({ onClose, reviews, averageRating, reviewsCount, sellerId, sellerName, sellerAvatar, currentUserId, currentProductId, side = "bottom" }: ProductReviewsDrawerProps) {
  const [items, setItems] = useState(reviews);
  const [count, setCount] = useState(reviewsCount);
  const [average, setAverage] = useState(averageRating);
  const [offset, setOffset] = useState(reviews.length);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(false);

  async function loadMore() {
    if (!sellerId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true); setError(null);
    try {
      const result = await loadSellerReviews({ sellerId, offset });
      if (!result.success) { setError(result.error); return; }
      const next = result.snapshot;
      setItems((previous) => Array.from(new Map([...previous, ...next.reviews].map((review) => [review.id, review])).values()));
      setOffset(offset + next.reviews.length);
      setCount(next.summary.count); setAverage(next.summary.average);
      setExhausted(next.reviews.length === 0);
    } catch { setError("No se pudieron cargar más reseñas. Inténtalo de nuevo."); }
    finally { loadingRef.current = false; setLoading(false); }
  }

  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent showClose={false} data-modal-open="true"
      className={side === "right"
        ? "left-auto right-0 top-0 bottom-0 h-dvh w-[min(480px,100vw)] max-w-none translate-x-0 translate-y-0 rounded-none p-0 gap-0 flex flex-col"
        : "left-auto right-0 top-0 bottom-0 h-dvh w-[92vw] max-w-md translate-x-0 translate-y-0 rounded-none p-0 gap-0 flex flex-col"}
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card-2 text-brand">
          {sellerAvatar ? <Image src={sellerAvatar} alt="" fill className="object-cover" unoptimized /> : sellerName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-base">{sellerName}</DialogTitle>
          <DialogDescription className="sr-only">Reseñas del local</DialogDescription>
          <div className="flex items-center gap-2"><RatingStars rating={average} size="sm" /><span className="text-xs text-fg-muted">({count} {count === 1 ? "reseña" : "reseñas"})</span></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar reseñas" className="flex min-h-12 min-w-12 items-center justify-center rounded-full hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-brand"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)_+_2rem)]">
        {items.length === 0 ? <p className="py-12 text-center text-sm text-fg-muted">Aún no hay reseñas para este local.</p> : items.map((review) => {
          const reviewer = Array.isArray(review.profiles) ? review.profiles[0] : review.profiles;
          const product = Array.isArray(review.products_services) ? review.products_services[0] : review.products_services;
          const own = currentUserId === review.reviewer_id;
          return <article key={review.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-2 font-medium text-brand">{publicProfileName(reviewer, "Usuario").charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-semibold">{publicProfileName(reviewer, "Usuario")}</span>{review.is_verified === true ? <VerifiedReviewLabel /> : null}</div>
                <RatingStars rating={review.rating} size="sm" />
              </div>
              {currentUserId && !own ? <ReportMenuButton targetType="review" targetId={review.id} targetLabel={review.comentario?.slice(0, 60) ?? `Reseña de ${publicProfileName(reviewer, "usuario")}`} iconSize={14} ariaLabel="Reportar reseña" /> : null}
            </div>
            {review.comentario ? <p className="text-sm leading-relaxed text-fg-muted">{review.comentario}</p> : null}
            {review.respuesta ? <div className="rounded-lg bg-card-2 p-3 text-sm"><div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Respuesta del vendedor</div><p className="text-fg-muted">{review.respuesta}</p></div> : null}
            {product && product.id !== currentProductId ? <div className="border-t border-border pt-2"><ReviewProductLink product={{ ...product, imagen_principal: product.imagen_principal ?? null }} /></div> : null}
          </article>;
        })}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {sellerId && offset < count && !exhausted ? <button type="button" onClick={loadMore} disabled={loading} className="min-h-12 w-full rounded-xl bg-card-2 px-4 text-sm font-semibold text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">{loading ? "Cargando…" : "Cargar más reseñas"}</button> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
