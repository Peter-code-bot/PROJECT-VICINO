import { UserAvatar } from "@/components/ui/user-avatar";
import { ConfiableBadge } from "./confiable-badge";
import type { RankedSeller } from "@/lib/rankings/types";

interface RankingListProps {
  sellers: RankedSeller[];
}

export function RankingList({ sellers }: RankingListProps) {
  if (sellers.length === 0) return null;

  return (
    <ul className="mt-6 flex flex-col gap-2 px-4">
      {sellers.map((seller) => (
        <li key={seller.seller_id}>
          <RankingRow seller={seller} />
        </li>
      ))}
    </ul>
  );
}

function RankingRow({ seller }: { seller: RankedSeller }) {
  const name = seller.display_name ?? "Vendedor";
  const scoreText = Math.round(seller.composite_score).toLocaleString("es-MX");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="w-6 text-sm tabular-nums text-muted-foreground">
        #{seller.rank}
      </span>
      <UserAvatar src={seller.foto} name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {seller.is_confiable ? (
          <div className="mt-1">
            <ConfiableBadge />
          </div>
        ) : null}
      </div>
      <span className="font-display text-base tabular-nums text-foreground">
        {scoreText}
      </span>
    </div>
  );
}
