"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  productId: string;
  initialFavorite: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function FavoriteButton({
  productId,
  initialFavorite,
  size = "md",
  className,
}: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const iconSize = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsFavorite(!isFavorite);
    startTransition(async () => {
      const result = await toggleFavorite(productId);
      if (result.isFavorite !== undefined) setIsFavorite(result.isFavorite);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
      className={cn(
        "rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-50",
        isFavorite
          ? "bg-red-500/80 text-white"
          : "bg-white/60 dark:bg-black/40 backdrop-blur-sm hover:bg-white/90",
        sizeClasses[size],
        className
      )}
    >
      <Heart
        className={cn(
          iconSize[size],
          isFavorite ? "fill-current" : "text-charcoal/70 dark:text-white/80"
        )}
      />
    </button>
  );
}
