import { Suspense } from "react";
import { Trophy } from "lucide-react";
import {
  getCategories,
  getAvailablePeriods,
  getRankingHiperlocal,
  currentPeriodInMexicoCity,
} from "@/lib/rankings/queries";
import { RankingHeader } from "@/components/rankings/ranking-header";
import { PodioRanking } from "@/components/rankings/podio-ranking";
import { RankingList } from "@/components/rankings/ranking-list";
import { ActivateLocationCard } from "@/components/rankings/activate-location-card";

export const metadata = { title: "Los Mejores de Vicino" };

type SearchParams = Promise<{
  category?: string;
  period?: string;
  lat?: string;
  lng?: string;
}>;

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  const [categories, periods] = await Promise.all([
    getCategories(),
    getAvailablePeriods(),
  ]);

  if (categories.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <EmptyState
          title="Aún no hay categorías"
          description="Vuelve más tarde cuando haya categorías activas."
        />
      </main>
    );
  }

  const currentCategoryId =
    sp.category && categories.some((c) => c.id === sp.category)
      ? sp.category
      : (categories[0]?.id ?? null);

  const currentPeriod =
    sp.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period)
      ? sp.period
      : (periods[0]?.period ?? currentPeriodInMexicoCity());

  const lat = sp.lat ? Number.parseFloat(sp.lat) : Number.NaN;
  const lng = sp.lng ? Number.parseFloat(sp.lng) : Number.NaN;
  const hasLocation =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-6">
      <RankingHeader
        categories={categories}
        periods={periods}
        currentCategoryId={currentCategoryId}
        currentPeriod={currentPeriod}
      />

      <div className="mt-6">
        {hasLocation && currentCategoryId ? (
          <Suspense
            key={`${currentCategoryId}:${currentPeriod}:${sp.lat}:${sp.lng}`}
            fallback={<RankingSkeleton />}
          >
            <RankingResults
              categoryId={currentCategoryId}
              period={currentPeriod}
              lat={lat}
              lng={lng}
            />
          </Suspense>
        ) : (
          <ActivateLocationCard />
        )}
      </div>
    </main>
  );
}

async function RankingResults({
  categoryId,
  period,
  lat,
  lng,
}: {
  categoryId: string;
  period: string;
  lat: number;
  lng: number;
}) {
  const result = await getRankingHiperlocal({
    category_id: categoryId,
    period,
    user_lat: lat,
    user_lng: lng,
    radius_meters: 5000,
    limit: 10,
  });

  if (!result.ok) {
    return (
      <EmptyState
        title="No pudimos cargar el ranking"
        description={result.error}
      />
    );
  }

  if (result.sellers.length === 0) {
    return (
      <EmptyState
        title="Aún no hay ranking en tu zona"
        description="Sé el primero en vender este mes y aparecerás aquí."
      />
    );
  }

  const top3 = result.sellers.filter((s) => s.rank <= 3);
  const rest = result.sellers.filter((s) => s.rank > 3);

  return (
    <div className="flex flex-col gap-6">
      <PodioRanking top3={top3} />
      {rest.length > 0 ? <RankingList sellers={rest} /> : null}
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center">
      <Trophy className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h2 className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 items-end gap-3 px-2 pt-6">
        <div className="flex justify-center">
          <div className="skeleton h-24 w-24 rounded-full" />
        </div>
        <div className="-mt-6 flex justify-center">
          <div className="skeleton h-32 w-32 rounded-full" />
        </div>
        <div className="flex justify-center">
          <div className="skeleton h-24 w-24 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
