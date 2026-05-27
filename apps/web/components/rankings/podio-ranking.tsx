import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { RankedSeller } from "@/lib/rankings/types";
import { ConfiableBadge } from "./confiable-badge";

interface PodioRankingProps {
  top3: RankedSeller[];
  className?: string;
}

/**
 * Asymmetric 1-2-3 podium. #2 left, #1 elevated center, #3 right.
 * If fewer than 3 sellers are given, renders only those positions:
 *   1 seller  -> centered #1 only
 *   2 sellers -> #1 center + #2 left
 *   3 sellers -> full podium
 */
export function PodioRanking({ top3, className }: PodioRankingProps) {
  const byRank = new Map<number, RankedSeller>(top3.map((s) => [s.rank, s]));
  const first = byRank.get(1);
  const second = byRank.get(2);
  const third = byRank.get(3);

  if (!first) return null;

  return (
    <div className={cn("grid grid-cols-3 items-end gap-3 px-2 pt-6", className)}>
      <div className="flex justify-center">
        {second ? <PodioSlot seller={second} position={2} /> : <div aria-hidden />}
      </div>
      <div className="flex justify-center -mt-6">
        <PodioSlot seller={first} position={1} />
      </div>
      <div className="flex justify-center">
        {third ? <PodioSlot seller={third} position={3} /> : <div aria-hidden />}
      </div>
    </div>
  );
}

interface PodioSlotProps {
  seller: RankedSeller;
  position: 1 | 2 | 3;
}

function PodioSlot({ seller, position }: PodioSlotProps) {
  const isFirst = position === 1;
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={cn(
          "relative rounded-full",
          isFirst
            ? "ring-2 ring-gold shadow-[0_0_60px_-12px_rgba(212,168,83,0.4)]"
            : "ring-2 ring-border-strong",
        )}
      >
        <UserAvatar
          src={seller.foto}
          name={seller.display_name}
          size={isFirst ? "xl" : "lg"}
        />
        <span
          className={cn(
            "absolute -bottom-2 left-1/2 -translate-x-1/2 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-display font-semibold tabular-nums",
            isFirst
              ? "bg-gold/20 text-gold ring-1 ring-inset ring-gold"
              : "bg-muted text-foreground ring-1 ring-inset ring-border-strong",
          )}
        >
          {position}
        </span>
      </div>

      <p
        className={cn(
          "mt-4 max-w-[10rem] truncate text-sm font-medium",
          isFirst ? "text-foreground" : "text-muted-foreground",
        )}
        title={seller.display_name}
      >
        {seller.display_name}
      </p>

      <p
        className={cn(
          "mt-1 font-display tabular-nums",
          isFirst ? "text-2xl text-gold font-semibold" : "text-base text-foreground",
        )}
      >
        {Math.round(seller.composite_score)}
      </p>

      {seller.is_confiable ? (
        <div className="mt-2">
          <ConfiableBadge />
        </div>
      ) : null}
    </div>
  );
}
