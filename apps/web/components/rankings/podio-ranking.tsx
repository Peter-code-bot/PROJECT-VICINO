import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ConfiableBadge } from "./confiable-badge";
import type { RankedSeller } from "@/lib/rankings/types";

interface PodioRankingProps {
  top3: RankedSeller[];
}

export function PodioRanking({ top3 }: PodioRankingProps) {
  if (top3.length === 0) return null;

  const first = top3[0] ?? null;
  const second = top3[1] ?? null;
  const third = top3[2] ?? null;

  return (
    <div className="grid grid-cols-3 items-end gap-3 px-4 pt-6">
      <div className="flex justify-center">
        {second ? <PodioSlot seller={second} position={2} /> : <div />}
      </div>
      <div className="flex justify-center">
        {first ? <PodioSlot seller={first} position={1} /> : <div />}
      </div>
      <div className="flex justify-center">
        {third ? <PodioSlot seller={third} position={3} /> : <div />}
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
  const scoreText = Math.round(seller.composite_score).toLocaleString("es-MX");
  const name = seller.display_name ?? "Vendedor";

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center min-w-0 max-w-[8.5rem]",
        isFirst && "-mt-6",
      )}
    >
      <UserAvatar
        src={seller.foto}
        name={name}
        size={isFirst ? "xl" : "lg"}
        className={cn(
          isFirst
            ? "ring-2 ring-gold shadow-[0_0_60px_-12px_rgba(212,168,83,0.4)]"
            : "ring-2 ring-border-strong",
        )}
      />
      <div
        className={cn(
          "mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full font-display text-sm font-semibold tabular-nums",
          isFirst
            ? "bg-gold/20 text-gold"
            : "bg-muted text-muted-foreground border border-border",
        )}
      >
        {position}
      </div>
      <p
        className={cn(
          "mt-2 w-full truncate text-sm font-medium",
          isFirst ? "text-foreground" : "text-muted-foreground",
        )}
        title={name}
      >
        {name}
      </p>
      <p
        className={cn(
          "mt-0.5 font-display text-lg leading-none tabular-nums",
          isFirst ? "text-gold" : "text-foreground",
        )}
      >
        {scoreText}
      </p>
      {seller.is_confiable ? (
        <div className="mt-1.5">
          <ConfiableBadge />
        </div>
      ) : null}
    </div>
  );
}
