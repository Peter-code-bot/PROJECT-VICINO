"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  ProductReviewsDrawer,
  type DrawerReview,
} from "./product-reviews-drawer";

interface ProductReviewsTriggerProps {
  reviews: DrawerReview[];
  averageRating: number;
  reviewsCount: number;
  sellerName: string;
  sellerAvatar: string | null;
  currentUserId: string | null;
  currentProductId: string;
}

export function ProductReviewsTrigger({
  reviews,
  averageRating,
  reviewsCount,
  sellerName,
  sellerAvatar,
  currentUserId,
  currentProductId,
}: ProductReviewsTriggerProps) {
  const [open, setOpen] = useState(false);

  if (reviews.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Abrir reseñas (${reviews.length})`}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        className="md:hidden fixed right-0 bottom-32 z-40 flex items-center gap-1.5 rounded-l-xl bg-primary text-primary-foreground px-2.5 py-3 shadow-lg active:bg-primary/90 transition-colors"
      >
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-xs font-semibold tracking-wider">
          RESEÑAS ({reviews.length})
        </span>
      </button>

      <ProductReviewsDrawer
        open={open}
        onClose={() => setOpen(false)}
        reviews={reviews}
        averageRating={averageRating}
        reviewsCount={reviewsCount}
        sellerName={sellerName}
        sellerAvatar={sellerAvatar}
        currentUserId={currentUserId}
        currentProductId={currentProductId}
      />
    </>
  );
}
