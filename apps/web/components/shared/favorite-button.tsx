"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";

interface FavoriteButtonProps {
  productId: string;
  initialFavorite: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "overlay" | "standalone";
  className?: string;
}

export function FavoriteButton({
  productId,
  initialFavorite,
  size = "md",
  variant = "overlay",
  className,
}: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);

  const { mutate, isPending } = useOptimisticMutation(toggleFavorite, {
    onMutate: () => {
      const previous = isFavorite;
      setIsFavorite(!previous);
      return () => setIsFavorite(previous);
    },
    onSuccess: (result) => {
      if (
        result &&
        typeof result === "object" &&
        "isFavorite" in result &&
        typeof result.isFavorite === "boolean"
      ) {
        setIsFavorite(result.isFavorite);
      }
    },
  });

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
    void hapticLight();
    void mutate(productId);
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
      className={cn(
        "rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-50",
        variant === "standalone"
          ? "hover:bg-[color:var(--brand-tint)]"
          : isFavorite
            ? "bg-[color:var(--danger)] text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]"
            : "bg-black/40 backdrop-blur-md hover:bg-black/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]",
        sizeClasses[size],
        className
      )}
    >
      <Heart
        className={cn(
          iconSize[size],
          variant === "standalone"
            ? isFavorite
              ? "fill-current text-[color:var(--danger)]"
              : "text-[color:var(--fg)]"
            : isFavorite
              ? "fill-current"
              : "text-white"
        )}
      />
    </button>
  );
}
