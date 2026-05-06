"use client";

import { useEffect, useRef } from "react";
import { MessageCircle, X } from "lucide-react";
import Image from "next/image";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

interface ReviewerProfile {
  nombre: string | null;
  foto: string | null;
  trust_level?: string | null;
}

interface ReviewedProduct {
  id: string;
  titulo: string;
  categoria: string;
  slug: string;
  imagen_principal: string | null;
}

export interface DrawerReview {
  id: string;
  rating: number;
  comentario: string | null;
  created_at: string;
  reviewer_id: string;
  respuesta: string | null;
  respuesta_fecha: string | null;
  profiles: ReviewerProfile | ReviewerProfile[] | null;
  products_services: ReviewedProduct | ReviewedProduct[] | null;
}

interface ProductReviewsDrawerProps {
  open: boolean;
  onClose: () => void;
  reviews: DrawerReview[];
  averageRating: number;
  reviewsCount: number;
  sellerName: string;
  sellerAvatar: string | null;
  currentUserId: string | null;
  currentProductId: string;
}

export function ProductReviewsDrawer({
  open,
  onClose,
  reviews,
  averageRating,
  reviewsCount,
  sellerName,
  sellerAvatar,
  currentUserId,
  currentProductId,
}: ProductReviewsDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reviews-drawer-title"
        className="absolute right-0 top-0 bottom-0 w-[92vw] max-w-md bg-background border-l border-border flex flex-col animate-slide-in-right"
      >
        <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center gap-3 z-10">
          <div className="w-12 h-12 rounded-full bg-card dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0 relative">
            {sellerAvatar ? (
              <Image
                src={sellerAvatar}
                alt={sellerName}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <span className="text-base font-heading font-semibold text-primary">
                {sellerName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="reviews-drawer-title"
              className="font-heading font-semibold text-base truncate"
            >
              {sellerName}
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <RatingStars rating={averageRating} size="lg" />
              <span className="text-xs text-muted-foreground font-medium">
                ({reviewsCount} {reviewsCount === 1 ? "reseña" : "reseñas"})
              </span>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Cerrar reseñas"
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-[calc(env(safe-area-inset-bottom)_+_2rem)]">
          {reviews.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 text-sm">
              Aún no hay reseñas para este producto.
            </p>
          ) : (
            reviews.map((review) => {
              const reviewer = Array.isArray(review.profiles)
                ? review.profiles[0]
                : review.profiles;
              const reviewedProduct = Array.isArray(review.products_services)
                ? review.products_services[0]
                : review.products_services;
              const isOwnReview =
                currentUserId !== null && review.reviewer_id === currentUserId;
              return (
                <div
                  key={review.id}
                  className="p-4 rounded-2xl bg-card border border-border/40 shadow-sm space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-card dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0 font-medium text-primary">
                      {reviewer?.nombre?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {reviewer?.nombre ?? "Usuario Verificado"}
                      </div>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>
                    {currentUserId && !isOwnReview && (
                      <ReportMenuButton
                        targetType="review"
                        targetId={review.id}
                        targetLabel={
                          review.comentario
                            ? review.comentario.slice(0, 60)
                            : `Reseña de ${reviewer?.nombre ?? "usuario"}`
                        }
                        iconSize={14}
                        ariaLabel="Reportar reseña"
                      />
                    )}
                  </div>
                  {review.comentario && (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {review.comentario}
                    </p>
                  )}
                  {review.respuesta && (
                    <div className="p-3 rounded-lg bg-muted/50 text-sm">
                      <div className="flex items-center gap-1.5 mb-1 text-primary font-medium text-xs">
                        <MessageCircle className="w-3.5 h-3.5 fill-current" />
                        Respuesta del vendedor
                      </div>
                      <span className="text-muted-foreground leading-relaxed pl-5 block">
                        {review.respuesta}
                      </span>
                    </div>
                  )}
                  {reviewedProduct?.id !== currentProductId && (
                    <div className="pt-2 border-t border-border/30">
                      <ReviewProductLink product={reviewedProduct ?? null} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
