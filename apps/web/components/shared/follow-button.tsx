"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleFollowStore } from "@/app/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { toast } from "sonner";

export interface FollowButtonProps {
  storeId: string;
  following: boolean;
  size?: "sm" | "lg";
  full?: boolean;
}

export function FollowButton({
  storeId,
  following: initialFollowing,
  size = "lg",
  full = true,
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
          ? "bg-[var(--card-2)] border border-[var(--border-strong)] text-[var(--fg)]"
          : "bg-[var(--brand)] text-white shadow-[0_8px_18px_rgba(31,90,78,0.4)]"
      )}
    >
      {following ? (
        <>
          <Check className="w-4 h-4 mr-1.5 text-[var(--brand-hi)]" />
          Siguiendo
        </>
      ) : (
        <>
          <Plus className="w-4 h-4 mr-1.5" />
          Seguir
        </>
      )}
    </button>
  );
}
