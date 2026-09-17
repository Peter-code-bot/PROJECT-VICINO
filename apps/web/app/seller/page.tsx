import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RatingStars } from "@/components/shared/rating-stars";
import { formatPrice } from "@vicino/shared";
import { TRUST_LEVELS } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";
import { Star, ChevronRight } from "lucide-react";

export const metadata = { title: "Dashboard Vendedor — VICINO" };

export default async function SellerOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_level, trust_points, average_rating, reviews_count, total_sales")
    .throwOnError()
    .eq("id", user.id)
    .single();

  // Sales this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthlySales } = await supabase
    .from("sale_confirmations")
    .select("precio_acordado")
    .throwOnError()
    .eq("seller_id", user.id)
    .eq("status", "completed")
    .gte("completed_at", startOfMonth.toISOString());

  const monthTotal = monthlySales?.reduce((sum, s) => sum + Number(s.precio_acordado), 0) ?? 0;

  // Active listings
  const { count: activeListings } = await supabase
    .from("products_services")
    .select("id", { count: "exact", head: true })
    .throwOnError()
    .eq("creador_id", user.id)
    .eq("estatus", "disponible");

  // Pending reviews (completed sales without seller_to_buyer review)
  const { data: completedSales } = await supabase
    .from("sale_confirmations")
    .select("id")
    .throwOnError()
    .eq("seller_id", user.id)
    .eq("status", "completed");

  const { data: sellerReviews } = await supabase
    .from("reviews")
    .select("sale_confirmation_id")
    .throwOnError()
    .eq("reviewer_id", user.id)
    .eq("review_type", "seller_to_buyer");

  const reviewedIds = new Set(sellerReviews?.map((r) => r.sale_confirmation_id) ?? []);
  const pendingReviews = completedSales?.filter((s) => !reviewedIds.has(s.id)).length ?? 0;

  const trustLevel = (profile?.trust_level as TrustLevel) ?? "nuevo";
  const trustConfig = TRUST_LEVELS[trustLevel];
  const sortedLevels = Object.entries(TRUST_LEVELS).sort((a, b) => a[1].minPoints - b[1].minPoints);
  const nextLevel = sortedLevels.find(
    ([, v]) => v.minPoints > (profile?.trust_points ?? 0)
  );

  const currentLevelPoints = trustConfig.minPoints;
  const nextLevelPoints = nextLevel ? nextLevel[1].minPoints : profile?.trust_points ?? 0;

  const progressPercent = nextLevel
    ? Math.min(100, Math.max(0, ((profile?.trust_points ?? 0) - currentLevelPoints) / (nextLevelPoints - currentLevelPoints)) * 100)
    : 100;

  return (
    <div className="space-y-6 animate-fade-in-up min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-bold mb-1 truncate">Mi Tienda</h1>
        <p className="text-sm text-[color:var(--fg-muted)] truncate">Resumen de tu actividad y métricas de ventas</p>
      </div>

      {/* 4 Métricas en Grid 2x2 sin iconos con títulos grandes y números centrados */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 min-w-0">
        {/* Card 1: Mes Actual */}
        <div className="flex flex-col justify-center rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5 min-w-0 min-h-[135px] sm:min-h-[155px] gap-2">
          <h3 className="font-bold text-xl text-[color:var(--fg)]">Mes Actual</h3>
          <p className="text-3xl sm:text-4xl font-heading font-extrabold text-[color:var(--fg)] tabular-nums">
            {formatPrice(monthTotal)}
          </p>
        </div>

        {/* Card 2: Inventario */}
        <div className="flex flex-col justify-center rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5 min-w-0 min-h-[135px] sm:min-h-[155px] gap-2">
          <div>
            <h3 className="font-bold text-xl text-[color:var(--fg)]">Inventario</h3>
            <p className="text-xs text-[color:var(--fg-muted)] mt-0.5">Publicaciones</p>
          </div>
          <p className="text-3xl sm:text-4xl font-heading font-extrabold text-[color:var(--fg)] tabular-nums">
            {activeListings ?? 0}
          </p>
        </div>

        {/* Card 3: Reputación */}
        <div className="flex flex-col justify-center rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5 min-w-0 min-h-[135px] sm:min-h-[155px] gap-2">
          <div>
            <h3 className="font-bold text-xl text-[color:var(--fg)]">Reputación</h3>
            <p className="text-xs text-[color:var(--fg-muted)] mt-0.5">Aprobación</p>
          </div>
          <div className="space-y-1">
            <p className="text-3xl sm:text-4xl font-heading font-extrabold text-[color:var(--fg)] tabular-nums leading-none">
              {Number(profile?.average_rating ?? 0).toFixed(1)}
            </p>
            <RatingStars
              rating={Number(profile?.average_rating ?? 0)}
              count={Number(profile?.reviews_count ?? 0)}
              size="sm"
              emptyStarClassName="fill-[color:var(--bg-elev-2)] text-[color:var(--bg-elev-2)]"
            />
          </div>
        </div>

        {/* Card 4: Histórico */}
        <div className="flex flex-col justify-center rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5 min-w-0 min-h-[135px] sm:min-h-[155px] gap-2">
          <div>
            <h3 className="font-bold text-xl text-[color:var(--fg)]">Histórico</h3>
            <p className="text-xs text-[color:var(--fg-muted)] mt-0.5">Ventas totales</p>
          </div>
          <p className="text-3xl sm:text-4xl font-heading font-extrabold text-[color:var(--fg)] tabular-nums">
            {profile?.total_sales ?? 0}
          </p>
        </div>
      </div>

      {/* Nivel de Confianza sin iconos */}
      <div className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading font-bold text-base sm:text-lg text-[color:var(--fg)]">Nivel de Confianza</h2>
            <p className="text-xs sm:text-sm text-[color:var(--fg-muted)]">Gana puntos para desbloquear beneficios</p>
          </div>
          <span className="shrink-0 text-xs sm:text-sm font-bold bg-transparent px-3.5 py-1 rounded-full border border-[color:var(--border)] text-[color:var(--fg)]">
            {profile?.trust_points ?? 0} pts
          </span>
        </div>

        <div className="space-y-2 pt-1">
          <div className="h-2.5 bg-[#1E242B] dark:bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[color:var(--brand)] rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.max(5, progressPercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-[color:var(--fg-muted)] font-medium">
            <span className="capitalize">{trustLevel}</span>
            {nextLevel ? (
              <span>
                Faltan <strong className="text-[color:var(--fg)]">{nextLevelPoints - (profile?.trust_points ?? 0)} pts</strong> para <span className="capitalize text-[color:var(--fg)]">{nextLevel[1].label}</span>
              </span>
            ) : (
              <span className="text-[color:var(--trust-gold)] font-bold">¡Nivel Máximo!</span>
            )}
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="space-y-3">
        <h2 className="font-heading font-bold text-base sm:text-lg text-[color:var(--fg)]">Acciones</h2>
        <Link
          href="/seller/reviews"
          className="flex items-center justify-between gap-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5 transition-opacity hover:opacity-90 group"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[color:var(--bg-elev-2)] flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-[color:var(--fg)] stroke-[1.8]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-[color:var(--fg)] truncate">
                Califica a tus compradores
              </h3>
              <p className="text-xs text-[color:var(--fg-muted)] truncate mt-0.5">
                {pendingReviews > 0
                  ? `Tienes ${pendingReviews} ventas completadas sin calificar.`
                  : "Estás al día con tus calificaciones."}
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-[color:var(--fg-muted)] shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
