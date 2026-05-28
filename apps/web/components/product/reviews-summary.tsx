import type { ProductDetailReview } from "./types";

interface ReviewsSummaryProps {
  reviews: ProductDetailReview[];
  averageRating: number;
  reviewsCount: number;
  sellerName: string;
  sellerAvatar: string | null;
  currentUserId: string | null;
  currentProductId: string;
}

export function ReviewsSummary(_props: ReviewsSummaryProps) {
  return <div>TODO ReviewsSummary</div>;
}
