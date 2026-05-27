import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PodioRanking } from "./podio-ranking";
import type { Category, RankedSeller } from "@/lib/rankings/types";

interface RankingPreviewWidgetProps {
  category: Category;
  top3: RankedSeller[];
}

export function RankingPreviewWidget({ category, top3 }: RankingPreviewWidgetProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Los mejores en
          </p>
          <h2 className="font-display text-lg font-semibold text-foreground">
            {category.nombre}
          </h2>
        </div>
        <Link
          href={{ pathname: "/rankings", query: { category: category.id } }}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Ver más
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {top3.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aún no hay ranking en tu zona — sé el primero en vender este mes.
        </p>
      ) : (
        <div className="-mx-1 mt-2 scale-[0.92] origin-top">
          <PodioRanking top3={top3} />
        </div>
      )}
    </section>
  );
}
