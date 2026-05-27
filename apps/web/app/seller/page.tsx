import { redirect } from "next/navigation";
import Link from "next/link";
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
    .select("trust_level, trust_points, average_rating, reviews_count, total_sales")
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
        <p className="text-sm text-[color:var(--fg-muted)]">Resumen de tu actividad y métricas de ventas</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <div className="relative overflow-hidden rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[color:var(--card-2)] p-5 group hover:border-[color:var(--brand-tint-strong)] transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-[color:var(--brand-tint)] text-[color:var(--trust-emerald)]">
              <Handshake className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-[color:var(--fg-muted)]">Mes Actual</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{monthCount}</p>
          <p className="text-sm font-medium text-[color:var(--trust-emerald)]">{formatPrice(monthTotal)} en ventas</p>
        </div>

        <div className="relative overflow-hidden rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[color:var(--card-2)] p-5 group hover:border-[color:var(--brand-tint-strong)] transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-[color:var(--fg-muted)]">Inventario</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{activeListings ?? 0}</p>
          <p className="text-sm font-medium text-[color:var(--brand-hi)]">Publicaciones activas</p>
        </div>

        <div className="relative overflow-hidden rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[color:var(--card-2)] p-5 group hover:border-[color:var(--brand-tint-strong)] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[rgba(212,168,83,0.18)] text-[color:var(--trust-gold)]">
                <Star className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-[color:var(--fg-muted)]">Reputación</span>
            </div>
            <RatingStars
              rating={Number(profile?.average_rating ?? 0)}
              count={Number(profile?.reviews_count ?? 0)}
              size="sm"
            />
          </div>
          <p className="text-3xl font-heading font-bold mb-1 tabular-nums">
            {Number(profile?.average_rating ?? 0).toFixed(1)}
          </p>
          <p className="text-sm font-medium text-[color:var(--trust-gold)]">Aprobación de clientes</p>
        </div>

        <div className="relative overflow-hidden rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[color:var(--card-2)] p-5 group hover:border-[color:var(--brand-tint-strong)] transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-[color:var(--bg-elev-2)] text-[color:var(--fg-muted)]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-[color:var(--fg-muted)]">Histórico</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{profile?.total_sales ?? 0}</p>
          <p className="text-sm font-medium text-[color:var(--fg-muted)]">Ventas totales en Vicino</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trust level progress */}
        <div className="lg:col-span-2 rounded-[var(--r-xl)] border border-[color:var(--border)] bg-[color:var(--card-2)] p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[color:var(--brand-tint)] flex items-center justify-center text-[color:var(--brand-hi)]">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg">Nivel de Confianza</h2>
              <p className="text-sm text-[color:var(--fg-muted)]">Gana puntos para desbloquear beneficios</p>
            </div>
          </div>
          
          <div className="p-5 rounded-[var(--r-xl)] bg-[color:var(--bg-elev-2)] border border-[color:var(--border)] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SellerBadge level={trustLevel} size="md" />
              </div>
              <span className="text-sm font-bold bg-[color:var(--bg-elev-2)] px-3 py-1 rounded-lg border border-[color:var(--border)]">
                {profile?.trust_points ?? 0} pts
              </span>
            </div>
            
            <div className="space-y-2">
              <div className="h-3 bg-[color:var(--border)] rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-[color:var(--brand)] rounded-full transition-all duration-1000 ease-out relative"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
                </div>
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
        </div>

        {/* Action Panel */}
        <div className="space-y-4">
          <h2 className="font-heading font-semibold text-lg pb-1">Acciones</h2>
          {/* Pending reviews alert */}
          <div className={`p-4 rounded-3xl border transition-all ${
            pendingReviews > 0
              ? "bg-amber-400/10 border-amber-400/30"
              : "bg-[color:var(--card-2)] border-[color:var(--border)]"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                pendingReviews > 0 ? "bg-amber-400/20" : "bg-[color:var(--bg-elev-2)]"
              }`}>
                {pendingReviews > 0 ? (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                ) : (
                  <Star className="w-4 h-4 text-[color:var(--fg-muted)]" />
                )}
              </div>
              <div>
                <h3 className={`font-semibold text-sm ${
                  pendingReviews > 0 ? "text-[color:var(--fg)]" : "text-[color:var(--fg)]"
                }`}>
                  Califica a tus compradores
                </h3>
                {pendingReviews > 0 ? (
                  <p className="text-xs mt-1 text-amber-400">
                    Tienes <strong>{pendingReviews}</strong> ventas completadas sin calificar.
                  </p>
                ) : (
                  <p className="text-xs mt-1 text-[color:var(--fg-muted)]">
                    Estás al día con tus calificaciones.
                  </p>
                )}
                {pendingReviews > 0 && (
                  <Link href="/seller/reviews" className="inline-flex items-center text-xs font-semibold text-amber-400 hover:text-amber-400/80 hover:underline mt-2 transition-colors">
                    Ir a reseñas →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
