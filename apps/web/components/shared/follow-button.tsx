"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleFollowStore } from "@/app/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { toast } from "sonner";

export interface FollowButtonProps {
  storeId: string;
  following: boolean;
  size?: "sm" | "lg";
  full?: boolean;
  className?: string;
  variant?: "default" | "profile";
}

export function FollowButton({
  storeId,
  following: initialFollowing,
  size = "lg",
  full = true,
  className,
  variant = "default",
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);

  const { mutate, isPending } = useOptimisticMutation(
    async () => {
      return toggleFollowStore(storeId, following);
    },
    {
      onMutate: () => {
        setFollowing(!following);
        return () => setFollowing(following); // rollback
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "No se pudo seguir a la tienda");
      }
    }
  );

  if (variant === "profile") {
    return (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mutate(undefined);
        }}
        disabled={isPending}
        className={cn(
          "flex-1 h-[54px] inline-flex items-center justify-center rounded-full bg-[#FBFAF6] border border-[rgba(17,22,45,0.05)] text-[#11162D] font-semibold text-[17px] shadow-[0_8px_18px_rgba(23,25,34,0.12),0_2px_5px_rgba(23,25,34,0.05)] active:translate-y-[1px] active:shadow-[0_3px_8px_rgba(23,25,34,0.10)] transition-[transform,box-shadow] duration-120 px-5 text-center leading-none disabled:opacity-70 disabled:cursor-not-allowed",
          className
        )}
      >
        {following ? "Siguiendo" : "Seguir"}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mutate(undefined);
      }}
      disabled={isPending}
      className={cn(
        "flex items-center justify-center font-medium transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed",
        full ? "flex-1 w-full" : "w-auto px-4",
        size === "lg" ? "h-[44px] text-[13.5px] rounded-full" : "h-[32px] text-[12px] rounded-full",
        following
          ? "bg-[var(--card-2)] text-[var(--fg)]"
          : "bg-[var(--brand)] text-white shadow-[0_8px_18px_rgba(31,90,78,0.4)]",
        className
      )}
    >
      {following ? (
        "Siguiendo"
      ) : (
        <>
          <Plus className="w-4 h-4 mr-1.5" />
          Seguir
        </>
      )}
    </button>
  );
}
