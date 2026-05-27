"use client";

import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { Category, RankingPeriod } from "@/lib/rankings/types";

interface RankingHeaderProps {
  categories: Category[];
  periods: RankingPeriod[];
  currentCategoryId: string | null;
  currentPeriod: string;
}

export function RankingHeader({
  categories,
  periods,
  currentCategoryId,
  currentPeriod,
}: RankingHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const periodLabel = useMemo(() => formatPeriodLabel(currentPeriod), [currentPeriod]);

  const updateParam = (key: "category" | "period", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Los Mejores de Vicino
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranking hiperlocal por categoría — solo vendedores en tu zona.
          </p>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors",
                "hover:border-border-strong",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label="Cambiar mes"
            >
              <span className="capitalize">{periodLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48">
            <ul className="flex flex-col gap-0.5">
              {periods.length === 0 ? (
                <li className="px-2 py-2 text-xs text-muted-foreground">
                  No hay períodos disponibles
                </li>
              ) : null}
              {periods.map((p) => {
                const isActive = p.period === currentPeriod;
                return (
                  <li key={p.period}>
                    <button
                      type="button"
                      onClick={() => updateParam("period", p.period)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm capitalize transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      <span>{formatPeriodLabel(p.period)}</span>
                      {p.is_frozen ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          cerrado
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      <nav
        aria-label="Categorías"
        className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        data-pending={pending ? "true" : undefined}
      >
        {categories.map((cat) => {
          const isActive = cat.id === currentCategoryId;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => updateParam("category", cat.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-muted text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
              aria-pressed={isActive}
            >
              {cat.nombre}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

function formatPeriodLabel(period: string): string {
  // period is YYYY-MM. Build a Date on day 1 in CDMX-equivalent UTC, then
  // format with Intl in es-MX.
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10) - 1;
  const d = new Date(Date.UTC(year, month, 15));
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
