import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { RankedSeller } from "@/lib/rankings/types";
import { ConfiableBadge } from "./confiable-badge";

interface RankingListProps {
  sellers: RankedSeller[];
  className?: string;
}

export function RankingList({ sellers, className }: RankingListProps) {
  if (sellers.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {sellers.map((seller) => (
        <RankingRow key={seller.seller_id} seller={seller} />
      ))}
    </ul>
  );
}

function RankingRow({ seller }: { seller: RankedSeller }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
      <span className="w-6 shrink-0 text-center text-sm font-display tabular-nums text-muted-foreground">
        {seller.rank}
      </span>
      <UserAvatar src={seller.foto} name={seller.display_name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={seller.display_name}>
          {seller.display_name}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          {seller.is_confiable ? <ConfiableBadge /> : null}
          {typeof seller.distancia_aprox === "number" ? (
            <span className="text-xs text-muted-foreground">
              {formatDistance(seller.distancia_aprox)}
            </span>
          ) : null}
        </div>
      </div>
      <span className="font-display tabular-nums text-sm font-semibold text-foreground">
        {Math.round(seller.composite_score)}
      </span>
    </li>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
