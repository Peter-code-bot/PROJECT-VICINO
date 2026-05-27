"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Category, RankingPeriod } from "@/lib/rankings/types";

interface RankingHeaderProps {
  categories: Category[];
  periods: RankingPeriod[];
  currentCategoryId: string | undefined;
  currentPeriod: string;
}

const monthFormatter = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  year: "numeric",
});

function formatPeriod(period: string): string {
  const date = new Date(`${period}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return period;
  const label = monthFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function RankingHeader({
  categories,
  periods,
  currentCategoryId,
  currentPeriod,
}: RankingHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const periodList = useMemo<RankingPeriod[]>(() => {
    if (periods.some((p) => p.period === currentPeriod)) return periods;
    return [{ period: currentPeriod, is_frozen: false }, ...periods];
  }, [periods, currentPeriod]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      next.set(key, value);
      router.push(`/rankings?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <header className="px-4 pt-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
        Los Mejores de Vicino
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Top de vendedores cerca de ti, mes con mes.
      </p>

      <div className="mt-4">
        <Popover>
          <PopoverTrigger
            className={cn(
              "inline-flex items-center gap-2 rounded-pill border border-border bg-muted px-3 py-1.5",
              "text-xs font-medium text-foreground transition-colors hover:border-border-strong",
            )}
          >
            {formatPeriod(currentPeriod)}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 overflow-y-auto">
            <ul className="flex flex-col">
              {periodList.map((p) => {
                const active = p.period === currentPeriod;
                return (
                  <li key={p.period}>
                    <button
                      type="button"
                      onClick={() => setParam("period", p.period)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {formatPeriod(p.period)}
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
        className="scrollbar-hide mt-5 flex gap-2 overflow-x-auto pb-1"
      >
        {categories.map((cat) => {
          const active = cat.id === currentCategoryId;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setParam("category", cat.id)}
              className={cn(
                "shrink-0 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-muted text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {cat.nombre}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
