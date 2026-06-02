import { Suspense } from "react";
import { Trophy } from "lucide-react";
import { ActivateLocationCard } from "@/components/rankings/activate-location-card";
import { PodioRanking } from "@/components/rankings/podio-ranking";
import { RankingHeader } from "@/components/rankings/ranking-header";
import { RankingList } from "@/components/rankings/ranking-list";
import {
  currentPeriodInMexicoCity,
  getAvailablePeriods,
  getCategories,
  getRankingHiperlocal,
  getActiveCategoryIdsForPeriod,
} from "@/lib/rankings/queries";
import type { RankedSeller } from "@/lib/rankings/types";

export const dynamic = "force-dynamic";

interface RankingsPageProps {
  searchParams: Promise<{
    category?: string;
    period?: string;
    lat?: string;
    lng?: string;
  }>;
}

function parseLatLng(latRaw?: string, lngRaw?: string): { lat: number; lng: number } | null {
  if (!latRaw || !lngRaw) return null;
  const lat = Number.parseFloat(latRaw);
  const lng = Number.parseFloat(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export default async function RankingsPage({ searchParams }: RankingsPageProps) {
  const sp = await searchParams;

  const categoryKey = sp.category ?? "default";
  const periodKey = sp.period ?? "default";
  const suspenseKey = `${categoryKey}-${periodKey}`;

  return (
    <Suspense key={suspenseKey} fallback={<RankingSkeleton />}>
      <RankingsContent searchParams={sp} />
    </Suspense>
  );
}

async function RankingsContent({
  searchParams,
}: {
  searchParams: Awaited<RankingsPageProps["searchParams"]>;
}) {
  const [allCategories, periods] = await Promise.all([
    getCategories(),
    getAvailablePeriods(),
  ]);

  if (allCategories.length === 0) {
    return (
      <main className="min-h-screen bg-background">
        <EmptyState
          title="Aún no hay categorías activas"
          message="Vuelve pronto."
        />
      </main>
    );
  }

  const currentPeriod =
    searchParams.period ?? periods[0]?.period ?? currentPeriodInMexicoCity();

  const activeCategoryIds = await getActiveCategoryIdsForPeriod(currentPeriod);
  const potentiallyActiveCategories = allCategories.filter((c) => activeCategoryIds.includes(c.id));

  const geo = parseLatLng(searchParams.lat, searchParams.lng);
  
  // Fallback to default coords if geo is not provided (this matches what we do in the Home widget)
  const defaultLat = Number.parseFloat(process.env.NEXT_PUBLIC_DEFAULT_COORDS_LAT ?? "19.0414");
  const defaultLng = Number.parseFloat(process.env.NEXT_PUBLIC_DEFAULT_COORDS_LNG ?? "-98.2063");
  const searchLat = geo?.lat ?? defaultLat;
  const searchLng = geo?.lng ?? defaultLng;

  // Pre-fetch rankings for all potentially active categories to see which ones actually have local data
  const localRankingsResults = await Promise.all(
    potentiallyActiveCategories.map(async (cat) => {
      try {
        const rankings = await getRankingHiperlocal({
          category_id: cat.id,
          period: currentPeriod,
          user_lat: searchLat,
          user_lng: searchLng,
          radius_meters: 10000,
          limit: 50,
        });
        return { category: cat, rankings };
      } catch {
        return { category: cat, rankings: [] };
      }
    })
  );

  // Filter out categories that have NO sellers in this local area
  const categoriesWithData = localRankingsResults.filter((res) => res.rankings.length > 0);
  const categories = categoriesWithData.map((res) => res.category);

  // If no categories have data locally
  if (categories.length === 0) {
    return (
      <main className="min-h-screen bg-background pb-12">
        <RankingHeader
          categories={[]}
          periods={periods}
          currentCategoryId={undefined}
          currentPeriod={currentPeriod}
        />
        {!geo ? (
          <ActivateLocationCard />
        ) : (
          <EmptyState
            title="Aún no hay ranking en tu zona"
            message="Sé el primero en vender este mes."
          />
        )}
      </main>
    );
  }

  const currentCategoryId =
    searchParams.category && categories.some((c) => c.id === searchParams.category)
      ? searchParams.category
      : categories[0]!.id;

  const selectedResult = categoriesWithData.find(c => c.category.id === currentCategoryId);
  const rankings = selectedResult?.rankings ?? [];

  const top3 = rankings.slice(0, 3);
  const rest = rankings.slice(3);
  const selectedCategoryName = selectedResult?.category.nombre ?? "Categoría";

  return (
    <main className="min-h-screen bg-background pb-12">
      <RankingHeader
        categories={categories}
        periods={periods}
        currentCategoryId={currentCategoryId}
        currentPeriod={currentPeriod}
      />

      <h2 className="mt-8 mb-6 px-4 text-center font-display text-2xl font-bold text-foreground">
        {selectedCategoryName}
      </h2>

      {!geo ? (
        <ActivateLocationCard />
      ) : (
        <>
          <PodioRanking top3={top3} />
          <RankingList sellers={rest} />
        </>
      )}
    </main>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <section className="mx-4 mt-8 rounded-xl border border-border bg-card p-8 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Trophy className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

function RankingSkeleton() {
  return (
    <main className="min-h-screen bg-background">
      <div className="px-4 pt-6">
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton mt-2 h-4 w-1/2" />
        <div className="skeleton mt-4 h-7 w-32" />
        <div className="mt-5 flex gap-2">
          <div className="skeleton h-7 w-20" />
          <div className="skeleton h-7 w-24" />
          <div className="skeleton h-7 w-16" />
        </div>
      </div>
      <div className="mt-8 px-4">
        <div className="skeleton h-40 w-full" />
      </div>
    </main>
  );
}
