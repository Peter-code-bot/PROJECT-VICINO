import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import {
  currentPeriodInMexicoCity,
  getCategories,
  getRankingHiperlocal,
  getActiveCategoryIdsForPeriod,
} from "@/lib/rankings/queries";
import type { Category, RankedSeller } from "@/lib/rankings/types";

const MEDAL_COLORS = {
  gold: {
    text: "text-gold",
    shadow: "shadow-[inset_0_0_0_1px_rgba(212,168,83,0.27)]",
    fill: "#D4A853",
    stroke: "#B8862A",
    ribbon: "#C48A5A",
  },
  silver: {
    text: "text-silver",
    shadow: "shadow-[inset_0_0_0_1px_rgba(168,176,173,0.27)]",
    fill: "#A8B0AD",
    stroke: "#7D8784",
    ribbon: "#8F9895",
  },
  bronze: {
    text: "text-bronze",
    shadow: "shadow-[inset_0_0_0_1px_rgba(196,138,90,0.27)]",
    fill: "#C48A5A",
    stroke: "#9E6B44",
    ribbon: "#A96F45",
  },
} as const;

const MEDAL_BY_RANK = {
  1: MEDAL_COLORS.gold,
  2: MEDAL_COLORS.silver,
  3: MEDAL_COLORS.bronze,
} as const;

function MedalSVG({
  rank,
  size = 18,
}: {
  rank: 1 | 2 | 3;
  size?: number;
}) {
  const medal = MEDAL_BY_RANK[rank];

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={Math.round(size * 1.17)}
      viewBox="0 0 48 56"
      fill="none"
      focusable="false"
    >
      <path
        d="M16.8 30.2 10 52l11.3-5.7L27 56l5.2-25.8H16.8Z"
        fill={medal.ribbon}
        opacity="0.86"
      />
      <path
        d="M31.2 30.2 38 52l-11.3-5.7L21 56l-5.2-25.8h15.4Z"
        fill={medal.stroke}
        opacity="0.78"
      />
      <circle
        cx="24"
        cy="22"
        r="18"
        fill={medal.fill}
        stroke={medal.stroke}
        strokeWidth="3"
      />
      <circle
        cx="24"
        cy="22"
        r="12.5"
        fill="rgba(255,255,255,0.22)"
        stroke="rgba(255,255,255,0.38)"
        strokeWidth="1"
      />
      <text
        x="24"
        y="27"
        textAnchor="middle"
        fontSize="15"
        fontWeight="800"
        fill="var(--color-foreground)"
        style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
      >
        {rank}
      </text>
    </svg>
  );
}

function formatMonth(period: string): string {
  const date = new Date(`${period}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return period;

  const formatter = new Intl.DateTimeFormat("es-MX", { month: "long" });
  const month = formatter.format(date);
  return month.charAt(0).toUpperCase() + month.slice(1);
}

// Keep this section dynamic: caching would freeze the daily category rotation.
export async function RankingsHomeStripSection() {
  let categories: Category[] = [];

  const period = currentPeriodInMexicoCity();

  try {
    const [allCategories, activeCategoryIds] = await Promise.all([
      getCategories(),
      getActiveCategoryIdsForPeriod(period),
    ]);
    categories = allCategories.filter((c) => activeCategoryIds.includes(c.id));
  } catch {
    return null;
  }

  if (categories.length === 0) return null;

  const dayIndex = new Date().getDate() % categories.length;
  const featuredCategory = categories[dayIndex] ?? categories[0];
  if (!featuredCategory) return null;
  // TODO: evolucionar a heuristica por popularidad cuando haya traccion.

  const defaultLat = Number.parseFloat(
    process.env.NEXT_PUBLIC_DEFAULT_COORDS_LAT ?? "19.0414",
  );
  const defaultLng = Number.parseFloat(
    process.env.NEXT_PUBLIC_DEFAULT_COORDS_LNG ?? "-98.2063",
  );

  let top3: RankedSeller[] = [];

  try {
    top3 = await getRankingHiperlocal({
      category_id: featuredCategory.id,
      period,
      user_lat: defaultLat,
      user_lng: defaultLng,
      radius_meters: 10000,
      limit: 3,
    });
  } catch {
    return null;
  }

  if (top3.length < 3) return null;

  return (
    <RankingsHomeStrip
      top3={top3}
      category={featuredCategory}
      period={period}
    />
  );
}

function RankingsHomeStrip({
  top3,
  category,
  period,
}: {
  top3: RankedSeller[];
  category: Category;
  period: string;
}) {
  const monthLabel = formatMonth(period);
  const categoryLabel = category.nombre ?? category.slug ?? "Categoria";

  return (
    <Link
      href={{ pathname: "/rankings", query: { category: category.id } }}
      aria-label={`Ver ranking completo de ${categoryLabel} en ${monthLabel}`}
      className="group block px-4 pb-6"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[20px] p-4",
          "bg-[linear-gradient(135deg,rgba(212,168,83,0.14)_0%,rgba(212,168,83,0.03)_50%,rgba(46,135,115,0.10)_100%)]",
          "shadow-[inset_0_0_0_1px_rgba(212,168,83,0.25)]",
          "transition-[transform,box-shadow] duration-200",
          "active:scale-[0.99]",
          "hover:shadow-[inset_0_0_0_1px_rgba(212,168,83,0.4)]",
        )}
      >
        <div className="mb-3.5 flex items-center gap-2.5">
          <MedalSVG rank={1} size={28} />
          <div className="min-w-0 flex-1">
            <span className="block text-[9.5px] font-bold uppercase tracking-[0.14em] text-gold">
              Ranking - {monthLabel}
            </span>
            <h3 className="truncate font-display text-base font-bold leading-tight text-foreground">
              Los mejores en <span className="text-gold">{categoryLabel}</span>
            </h3>
          </div>
          <ArrowRight
            className="shrink-0 text-gold transition-transform group-hover:translate-x-0.5"
            size={18}
          />
        </div>

        <div className="flex items-stretch gap-2">
          {([2, 1, 3] as const).map((rank) => {
            const seller = top3[rank - 1];
            if (!seller) return null;

            const tone = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
            const medal = MEDAL_COLORS[tone];
            const name = seller.display_name ?? "Vendedor";
            const scoreText = Math.round(seller.composite_score).toLocaleString("es-MX");

            return (
              <div
                key={rank}
                className={cn(
                  "relative flex min-w-0 items-center gap-2 rounded-[14px] bg-card/60 p-2.5 backdrop-blur-[10px]",
                  rank === 1 ? "flex-[1.2]" : "flex-1",
                  medal.shadow,
                )}
              >
                <span className="sr-only">
                  Puesto {rank}: {name}, puntaje {scoreText}
                </span>
                <div className="relative shrink-0">
                  <UserAvatar src={seller.foto} name={name} size="sm" />
                  <div className="absolute -bottom-1 -right-1">
                    <MedalSVG rank={rank} size={16} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[11px] font-medium leading-tight text-foreground"
                    title={name}
                  >
                    {name}
                  </p>
                  <p
                    className={cn(
                      "font-display text-sm font-bold leading-tight tabular-nums",
                      medal.text,
                    )}
                  >
                    {scoreText}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Link>
  );
}
