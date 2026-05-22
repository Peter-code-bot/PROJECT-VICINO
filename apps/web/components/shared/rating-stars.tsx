import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  rating: number;
  count?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const STAR_SIZE_MAP = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export function RatingStars({
  rating,
  count,
  size = "sm",
  className,
}: RatingStarsProps) {
  const starSize = STAR_SIZE_MAP[size];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              starSize,
              "transition-colors duration-200",
              star <= Math.round(rating)
                ? "fill-gold text-gold"
                : "fill-[color:var(--border)] text-[color:var(--border)]"
            )}
          />
        ))}
      </div>
      {rating > 0 && (
        <span className="text-xs text-muted-foreground font-medium">
          {rating.toFixed(1)}
          {count !== undefined && (
            <span className="text-muted-foreground/60"> ({count})</span>
          )}
        </span>
      )}
    </div>
  );
}
