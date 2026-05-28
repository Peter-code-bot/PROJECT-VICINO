"use client";

import Image from "next/image";
import { Star } from "lucide-react";
import { RatingStars } from "@/components/shared/rating-stars";
import type { ProductDetailReview } from "./types";

interface ReviewsSummaryProps {
  reviews: ProductDetailReview[];
  averageRating: number;
  reviewsCount: number;
  onOpenReviews: () => void;
}

interface BreakdownRow {
  star: number;
  count: number;
  pct: number;
}

function buildBreakdown(reviews: ProductDetailReview[]): BreakdownRow[] {
  const buckets: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of reviews) {
    const rounded = Math.max(1, Math.min(5, Math.round(r.rating)));
    buckets[rounded] = (buckets[rounded] ?? 0) + 1;
  }
  const total = reviews.length;
  return [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: buckets[star] ?? 0,
    pct: total === 0 ? 0 : Math.round(((buckets[star] ?? 0) * 100) / total),
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
  averageRating,
  reviewsCount,
  onOpenReviews,
}: ReviewsSummaryProps) {
  const breakdown = buildBreakdown(reviews);
  const best = pickBestReview(reviews);
  const bestReviewer = best
    ? Array.isArray(best.profiles)
      ? best.profiles[0]
      : best.profiles
    : null;
  const totalLabel =
    reviewsCount === 1 ? `${reviewsCount} reseña` : `${reviewsCount} reseñas`;

  if (!reviews || reviews.length === 0) {
    return (
      <section className="flex flex-col gap-4 rounded-[var(--r-lg)] bg-card p-4 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex items-center gap-3">
          <span className="font-display text-3xl font-semibold leading-none text-fg-muted">
            -.-
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <RatingStars rating={0} size="md" />
            <span className="text-xs text-fg-muted">0 reseñas</span>
          </div>
        </div>
        <div className="rounded-[var(--r-md)] bg-card-2 p-4 text-center">
          <p className="text-sm font-medium text-fg">Sin reseñas todavía</p>
          <p className="text-xs text-fg-muted mt-1">Este vendedor aún no ha recibido reseñas.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-[var(--r-lg)] bg-card p-4 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="flex items-center gap-3">
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
                  alt={bestReviewer.nombre ?? "Reseñador"}
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-fg-muted">
                  {(bestReviewer?.nombre ?? "?").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="truncate text-xs font-semibold text-fg">
              {bestReviewer?.nombre ?? "Comprador verificado"}
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
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r-md)] bg-card-2 px-4 py-2.5 text-sm font-semibold text-brand-hi shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-colors hover:bg-brand-tint"
      >
        Ver {totalLabel}
        <span aria-hidden>→</span>
      </button>
    </section>
  );
}
