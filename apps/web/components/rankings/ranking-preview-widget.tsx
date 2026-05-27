import Link from "next/link";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category, RankedSeller } from "@/lib/rankings/types";
import { PodioRanking } from "./podio-ranking";

interface RankingPreviewWidgetProps {
  category: Category;
  top3: RankedSeller[];
  className?: string;
}

/**
 * Compact mini-podium for the home page. Renders the top 3 sellers in a
 * category and links to the full /rankings page filtered to that category.
 * If there are no sellers in the user's zone yet, shows a quiet empty state.
 */
export function RankingPreviewWidget({
  category,
  top3,
  className,
}: RankingPreviewWidgetProps) {
  const href = `/rankings?category=${encodeURIComponent(category.id)}`;
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-4 sm:p-5",
        className,
      )}
      aria-label={`Los mejores en ${category.nombre}`}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="h-4 w-4 text-gold shrink-0" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground truncate">
            Los mejores en {category.nombre}
          </h2>
        </div>
        <Link
          href={href}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          Ver más
        </Link>
      </header>

      {top3.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aún no hay ranking en tu zona — sé el primero en vender este mes.
        </p>
      ) : (
        <PodioRanking top3={top3} className="!pt-2" />
      )}
    </section>
  );
}
