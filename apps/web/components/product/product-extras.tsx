"use client";

import { publicProfileName } from "@vicino/shared";
import { Suspense, use, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CouponBlock } from "./coupon-block";
import { ReviewsSummary } from "./reviews-summary";
import { ProductReviewsDrawer } from "./product-reviews-drawer";
import { LocalReviewDialog } from "./local-review-dialog";
import { localReviewReturnPath } from "@/lib/reviews/navigation";
import { EMPTY_REVIEW_SUMMARY, type OwnLocalReview } from "@/lib/reviews/contracts";
import type { ProductDetailExtras, ProductDetailCoupon, ProductDetailReview, ProductDetailSeller } from "./types";

function RetryExtras({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div className="text-sm text-fg-muted">
      <p>{message}</p>
      <button type="button" onClick={() => router.refresh()} className="min-h-11 font-semibold text-brand">
        Reintentar
      </button>
    </div>
  );
}

function CouponsContent({ extras, coupons }: { extras?: Promise<ProductDetailExtras>; coupons: ProductDetailCoupon[] }) {
  const result = extras ? use(extras) : { coupons };
  if ("couponsError" in result && result.couponsError) return <RetryExtras message={result.couponsError} />;
  return <CouponBlock coupons={result.coupons} />;
}

export function ProductCoupons(props: { extras?: Promise<ProductDetailExtras>; coupons: ProductDetailCoupon[] }) {
  return (
    <Suspense fallback={null}>
      <CouponsContent {...props} />
    </Suspense>
  );
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
  const result: ProductDetailExtras = extras ? use(extras) : { reviews, coupons: [] };
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openLocalReview, setOpenLocalReview] = useState(() => searchParams.get("reviewLocal") === "1" && Boolean(currentUserId));
  const [savedReview, setSavedReview] = useState<OwnLocalReview | null>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const activePresentation = side === "right" ? desktop : !desktop;

  if ("reviewsError" in result && result.reviewsError) return <RetryExtras message={result.reviewsError} />;
  const summary = result.reviewSummary ?? EMPTY_REVIEW_SUMMARY;

  function handleAddReview() {
    if (!currentUserId) {
      router.push(`/login?next=${encodeURIComponent(localReviewReturnPath(window.location.href))}`);
      return;
    }
    setOpenLocalReview(true);
  }

  return (
    <>
      <ReviewsSummary
        reviews={result.reviews}
        summary={summary}
        onOpenReviews={() => setOpen(true)}
        onAddReview={currentUserId === seller.id ? undefined : handleAddReview}
      />
      <ProductReviewsDrawer
        open={open && activePresentation}
        onClose={() => setOpen(false)}
        reviews={result.reviews}
        averageRating={summary.average}
        reviewsCount={summary.count}
        sellerId={seller.id}
        sellerName={publicProfileName(seller, "Vendedor")}
        sellerAvatar={seller.foto ?? null}
        currentUserId={currentUserId}
        currentProductId={productId}
        side={side}
      />
      <LocalReviewDialog
        open={openLocalReview && activePresentation && currentUserId !== seller.id}
        onClose={() => {
          setOpenLocalReview(false);
          const context = new URL(window.location.href);
          context.searchParams.delete("reviewLocal");
          window.history.replaceState(window.history.state, "", context.pathname + context.search + context.hash);
        }}
        sellerId={seller.id}
        sellerName={publicProfileName(seller, "Vendedor")}
        sellerAvatar={seller.foto ?? null}
        ownReview={savedReview ?? result.ownLocalReview}
        onSuccess={setSavedReview}
      />
    </>
  );
}

function isDesktop() { return window.matchMedia("(min-width: 768px)").matches; }
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function ProductReviews(props: ReviewsProps) {
  return (
    <Suspense fallback={<p className="text-sm text-fg-muted">Cargando reseñas…</p>}>
      <ReviewsContent key={props.seller.id} {...props} />
    </Suspense>
  );
}
