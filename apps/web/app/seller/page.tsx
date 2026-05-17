import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { formatPrice } from "@vicino/shared";
import { TRUST_LEVELS } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";
import { Package, Handshake, Star, TrendingUp, AlertCircle, Award } from "lucide-react";

export const metadata = { title: "Dashboard Vendedor — VICINO" };

export default async function SellerOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_level, trust_points, average_rating_as_seller, reviews_count_as_seller, total_sales")
    .eq("id", user.id)
    .single();

  // Sales this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthlySales } = await supabase
    .from("sale_confirmations")
    .select("precio_acordado")
    .eq("seller_id", user.id)
    .eq("status", "completed")
    .gte("completed_at", startOfMonth.toISOString());

  const monthCount = monthlySales?.length ?? 0;
  const monthTotal = monthlySales?.reduce((sum, s) => sum + Number(s.precio_acordado), 0) ?? 0;

  // Active listings
  const { count: activeListings } = await supabase
    .from("products_services")
    .select("id", { count: "exact", head: true })
    .eq("creador_id", user.id)
    .eq("estatus", "disponible");

  // Pending reviews (completed sales without seller_to_buyer review)
  const { data: completedSales } = await supabase
    .from("sale_confirmations")
    .select("id")
    .eq("seller_id", user.id)
    .eq("status", "completed");

  const { data: sellerReviews } = await supabase
    .from("reviews")
    .select("sale_confirmation_id")
    .eq("reviewer_id", user.id)
    .eq("review_type", "seller_to_buyer");

  const reviewedIds = new Set(sellerReviews?.map((r) => r.sale_confirmation_id) ?? []);
  const pendingReviews = completedSales?.filter((s) => !reviewedIds.has(s.id)).length ?? 0;

  const trustLevel = (profile?.trust_level as TrustLevel) ?? "nuevo";
  const trustConfig = TRUST_LEVELS[trustLevel];
  // Calculate next trust level logic safely
  const sortedLevels = Object.entries(TRUST_LEVELS).sort((a, b) => a[1].minPoints - b[1].minPoints);
  const nextLevel = sortedLevels.find(
    ([, v]) => v.minPoints > (profile?.trust_points ?? 0)
  );
  
  const currentLevelPoints = trustConfig.minPoints;
  const nextLevelPoints = nextLevel ? nextLevel[1].minPoints : profile?.trust_points ?? 0;
  
  // Progress percentage relative to current tier
  const progressPercent = nextLevel
    ? Math.min(100, Math.max(0, ((profile?.trust_points ?? 0) - currentLevelPoints) / (nextLevelPoints - currentLevelPoints)) * 100)
    : 100;

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-heading font-bold mb-1">Mi Tienda</h1>
        <p className="text-sm text-muted-foreground">Resumen de tu actividad y métricas de ventas</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-emerald-trust/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-trust/10 text-emerald-trust">
              <Handshake className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Mes Actual</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{monthCount}</p>
          <p className="text-sm font-medium text-emerald-trust/80">{formatPrice(monthTotal)} en ventas</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-brand/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Inventario</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{activeListings ?? 0}</p>
          <p className="text-sm font-medium text-brand/80">Publicaciones activas</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-gold/30 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gold/10 text-gold">
                <Star className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Reputación</span>
            </div>
            <RatingStars
              rating={Number(profile?.average_rating_as_seller ?? 0)}
              count={Number(profile?.reviews_count_as_seller ?? 0)}
              size="sm"
            />
          </div>
          <p className="text-3xl font-heading font-bold mb-1 tabular-nums">
            {Number(profile?.average_rating_as_seller ?? 0).toFixed(1)}
          </p>
          <p className="text-sm font-medium text-gold/80">Aprobación de clientes</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-blue-500/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
              <TrendingUp className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Histórico</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{profile?.total_sales ?? 0}</p>
          <p className="text-sm font-medium text-blue-500/80">Ventas totales en Vicino</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trust level progress */}
        <div className="lg:col-span-2 rounded-3xl border border-border/50 bg-white dark:bg-neutral-900 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center text-brand">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg">Nivel de Confianza</h2>
              <p className="text-sm text-muted-foreground">Gana puntos para desbloquear beneficios</p>
            </div>
          </div>
          
          <div className="p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-border/30 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SellerBadge level={trustLevel} size="md" />
              </div>
              <span className="text-sm font-bold bg-white dark:bg-neutral-800 px-3 py-1 rounded-lg border border-border/50 shadow-sm">
                {profile?.trust_points ?? 0} pts
              </span>
            </div>
            
            <div className="space-y-2">
              <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-brand rounded-full transition-all duration-1000 ease-out relative"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span className="capitalize">{trustLevel}</span>
                {nextLevel ? (
                  <span>
                    Faltan <strong className="text-foreground">{nextLevelPoints - (profile?.trust_points ?? 0)} pts</strong> para <span className="capitalize text-foreground">{nextLevel[1].label}</span>
                  </span>
                ) : (
                  <span className="text-gold font-bold">¡Nivel Máximo!</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="space-y-4">
          <h2 className="font-heading font-semibold text-lg pb-1">Acciones</h2>
          {/* Pending reviews alert */}
          <div className={`p-4 rounded-3xl border transition-all ${
            pendingReviews > 0 
              ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50 hover:shadow-md" 
              : "bg-card border-border/40"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                pendingReviews > 0 ? "bg-amber-200 dark:bg-amber-800" : "bg-neutral-100 dark:bg-neutral-800"
              }`}>
                {pendingReviews > 0 ? (
                  <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-200" />
                ) : (
                  <Star className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div>
                <h3 className={`font-semibold text-sm ${
                  pendingReviews > 0 ? "text-amber-900 dark:text-amber-100" : "text-foreground"
                }`}>
                  Califica a tus compradores
                </h3>
                {pendingReviews > 0 ? (
                  <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                    Tienes <strong>{pendingReviews}</strong> ventas completadas sin calificar.
                  </p>
                ) : (
                  <p className="text-xs mt-1 text-muted-foreground">
                    Estás al día con tus calificaciones.
                  </p>
                )}
                {pendingReviews > 0 && (
                  <a href="/seller/reviews" className="inline-flex items-center text-xs font-semibold text-amber-800 dark:text-amber-200 hover:underline mt-2">
                    Ir a reseñas →
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
