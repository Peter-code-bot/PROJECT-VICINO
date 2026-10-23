"use client";

import { publicProfileName } from "@vicino/shared";
import Image from "next/image";
import { Star, Plus } from "lucide-react";
import { RatingStars } from "@/components/shared/rating-stars";
import type { ProductDetailReview } from "./types";
import type { SellerReviewSummary } from "@/lib/reviews/contracts";

interface ReviewsSummaryProps {
  reviews: ProductDetailReview[];
  summary: SellerReviewSummary;
  onOpenReviews: () => void;
  onAddReview?: () => void;
}

interface BreakdownRow {
  star: number;
  count: number;
  pct: number;
}

function buildBreakdown(summary: SellerReviewSummary): BreakdownRow[] {
  return ([5, 4, 3, 2, 1] as const).map((star) => ({
    star,
    count: summary.buckets[star],
    pct: summary.count === 0 ? 0 : Math.round((summary.buckets[star] * 100) / summary.count),
  }));
}

function pickBestReview(reviews: ProductDetailReview[]): ProductDetailReview | null {
  return reviews.find((r) => r.rating === 5) ?? reviews[0] ?? null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}...`;
}

export function ReviewsSummary({
  reviews,
  summary,
  onOpenReviews,
  onAddReview,
}: ReviewsSummaryProps) {
  const breakdown = buildBreakdown(summary);
  const { count: reviewsCount, average: averageRating } = summary;
  const best = pickBestReview(reviews);
  const bestReviewer = best
    ? Array.isArray(best.profiles)
      ? best.profiles[0]
      : best.profiles
    : null;
  const totalLabel =
    reviewsCount === 1 ? `${reviewsCount} reseña` : `${reviewsCount} reseñas`;

  if (reviewsCount === 0) {
    return (
      <section className="relative flex flex-col gap-4 rounded-[var(--r-lg)] product-card-custom p-4">
        {onAddReview && (
          <button
            type="button"
            onClick={onAddReview}
            aria-label="Escribir reseña del local"
            className="absolute top-2.5 right-2.5 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full text-brand-hi hover:bg-brand-tint transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand z-10"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="flex items-center gap-3 pr-12">
          <span className="font-display text-3xl font-semibold leading-none text-fg-muted">
            -.-
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <RatingStars rating={0} size="md" />
            <span className="text-xs text-fg-muted">0 reseñas</span>
          </div>
        </div>
        <div className="rounded-[var(--r-md)] p-4 text-center">
          <p className="text-sm font-medium text-fg">Sin reseñas todavía</p>
          <p className="text-xs text-fg-muted mt-1">Este vendedor aún no ha recibido reseñas.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex flex-col gap-4 rounded-[var(--r-lg)] product-card-custom p-4">
      {onAddReview && (
        <button
          type="button"
          onClick={onAddReview}
          aria-label="Escribir reseña del local"
          className="absolute top-2.5 right-2.5 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full text-brand-hi hover:bg-brand-tint transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand z-10"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <div className="flex items-center gap-3 pr-12">
        <span className="font-display text-3xl font-semibold leading-none text-fg">
          {Number(averageRating).toFixed(1)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <RatingStars rating={Number(averageRating)} size="md" />
          <span className="text-xs text-fg-muted">{totalLabel}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {breakdown.map(({ star, count, pct }) => (
          <div
            key={star}
            className="flex items-center gap-2 text-xs text-fg-muted"
          >
            <span className="inline-flex w-6 items-center gap-0.5 tabular-nums">
              {star}
              <Star
                className="h-3 w-3 fill-current text-fg-dim"
                aria-hidden
              />
            </span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-card-2">
              <div
                className="absolute inset-y-0 left-0 bg-emerald-trust"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-7 text-right tabular-nums text-fg-dim">
              {count}
            </span>
          </div>
        ))}
      </div>

      {best && best.comentario ? (
        <div className="flex flex-col gap-2 rounded-[var(--r-md)] bg-card-2 p-3">
          <div className="flex items-center gap-2">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card">
              {bestReviewer?.foto ? (
                <Image
                  src={bestReviewer.foto}
                  alt={publicProfileName(bestReviewer, "Reseñador")}
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-fg-muted">
                  {(publicProfileName(bestReviewer)).charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="truncate text-xs font-semibold text-fg">
              {publicProfileName(bestReviewer, "Usuario")}
            </span>
            <RatingStars
              rating={best.rating}
              size="sm"
              className="ml-auto"
            />
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">
            {truncate(best.comentario, 140)}
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpenReviews}
        className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-[var(--r-md)] bg-card-2 px-4 py-2.5 text-sm font-semibold text-brand-hi shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-colors hover:bg-brand-tint focus-visible:ring-2 focus-visible:ring-brand"
      >
        Ver {totalLabel}
        <span aria-hidden>→</span>
      </button>
    </section>
  );
}
