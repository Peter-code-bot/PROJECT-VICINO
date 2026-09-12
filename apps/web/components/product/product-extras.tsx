"use client";

import { Suspense, use, useState } from "react";
import { useRouter } from "next/navigation";
import { CouponBlock } from "./coupon-block";
import { ReviewsSummary } from "./reviews-summary";
import { ProductReviewsTrigger } from "./product-reviews-trigger";
import type { DrawerReview } from "./product-reviews-drawer";
import type { ProductDetailExtras, ProductDetailCoupon, ProductDetailReview, ProductDetailSeller } from "./types";

function RetryExtras({ message }: { message: string }) {
  const router = useRouter();
  return <div className="text-sm text-fg-muted"><p>{message}</p><button type="button" onClick={() => router.refresh()} className="min-h-11 font-semibold text-brand">Reintentar</button></div>;
}

function CouponsContent({ extras, coupons }: { extras?: Promise<ProductDetailExtras>; coupons: ProductDetailCoupon[] }) {
  const result = extras ? use(extras) : { coupons };
  if ("couponsError" in result && result.couponsError) return <RetryExtras message={result.couponsError} />;
  return <CouponBlock coupons={result.coupons} />;
}

export function ProductCoupons(props: { extras?: Promise<ProductDetailExtras>; coupons: ProductDetailCoupon[] }) {
  return <Suspense fallback={null}><CouponsContent {...props} /></Suspense>;
}

interface ReviewsProps {
  extras?: Promise<ProductDetailExtras>;
  reviews: ProductDetailReview[];
  seller: ProductDetailSeller;
  currentUserId: string | null;
  productId: string;
  side?: "right";
}

function ReviewsContent({ extras, reviews, seller, currentUserId, productId, side }: ReviewsProps) {
  const result = extras ? use(extras) : { reviews };
  const [open, setOpen] = useState(false);
  if ("reviewsError" in result && result.reviewsError) return <RetryExtras message={result.reviewsError} />;
  const count = Number(seller.reviews_count ?? result.reviews.length);
  const rating = Number(seller.average_rating ?? 0);
  return <>
    <ReviewsSummary reviews={result.reviews} averageRating={rating} reviewsCount={count} onOpenReviews={() => setOpen(true)} />
    <ProductReviewsTrigger reviews={result.reviews as unknown as DrawerReview[]} averageRating={rating} reviewsCount={count}
      sellerName={seller.nombre ?? "Vendedor"} sellerAvatar={seller.foto ?? null} currentUserId={currentUserId}
      currentProductId={productId} externalOpen={open} onExternalClose={() => setOpen(false)} side={side} />
  </>;
}

export function ProductReviews(props: ReviewsProps) {
  return <Suspense fallback={<p className="text-sm text-fg-muted">Cargando reseñas…</p>}><ReviewsContent {...props} /></Suspense>;
}
