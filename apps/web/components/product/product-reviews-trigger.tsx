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
  /**
   * Controlled mode. If provided, the parent owns the drawer open state and
   * the floating vertical trigger button is hidden so the parent renders its
   * own entry point (e.g. ReviewsSummary "Ver las N reseñas"). When the prop
   * is undefined the component behaves exactly like the legacy uncontrolled
   * trigger so existing call sites stay unchanged.
   */
  externalOpen?: boolean;
  onExternalClose?: () => void;
  /**
   * Forwarded to the underlying drawer. Use "right" for the desktop side
   * sheet, leave undefined (default "bottom") for the mobile right-overlay
   * legacy behavior.
   */
  side?: "bottom" | "right";
}

export function ProductReviewsTrigger({
  reviews,
  averageRating,
  reviewsCount,
  sellerName,
  sellerAvatar,
  currentUserId,
  currentProductId,
  externalOpen,
  onExternalClose,
  side,
}: ProductReviewsTriggerProps) {
  const controlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlled ? Boolean(externalOpen) : internalOpen;

  function handleClose() {
    if (controlled) {
      onExternalClose?.();
    } else {
      setInternalOpen(false);
    }
  }

  if (reviews.length === 0) return null;

  return (
    <>
      {controlled ? null : (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
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
      )}

      <ProductReviewsDrawer
        open={open}
        onClose={handleClose}
        reviews={reviews}
        averageRating={averageRating}
        reviewsCount={reviewsCount}
        sellerName={sellerName}
        sellerAvatar={sellerAvatar}
        currentUserId={currentUserId}
        currentProductId={currentProductId}
        side={side}
      />
    </>
  );
}
