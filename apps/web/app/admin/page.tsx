import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@vicino/shared";
import { Users, Package, Handshake, TrendingUp, AlertCircle, ShieldAlert } from "lucide-react";

export const metadata = { title: "Panel Admin — VICINO" };

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: roleCheck } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user?.id ?? "")
    .eq("role", "admin")
    .maybeSingle();
  const isFullAdmin = !!roleCheck;

  const { count: totalUsers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const { count: totalSellers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("es_vendedor", true);

  const { count: activeProducts } = await supabase
    .from("products_services")
    .select("id", { count: "exact", head: true })
    .eq("estatus", "disponible");

  const { data: allSales } = await supabase
    .from("sale_confirmations")
    .select("precio_acordado")
    .eq("status", "completed");

  const totalSales = allSales?.length ?? 0;
  const totalValue = allSales?.reduce((s, r) => s + Number(r.precio_acordado), 0) ?? 0;

  // This month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthlySales } = await supabase
    .from("sale_confirmations")
    .select("precio_acordado")
    .eq("status", "completed")
    .gte("completed_at", startOfMonth.toISOString());

  const monthCount = monthlySales?.length ?? 0;

  // Pending verifications
  const { count: pendingVerifications } = await supabase
    .from("seller_verification")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // Open disputes
  const { count: openDisputes } = await supabase
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "under_review"]);

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-heading font-bold mb-1">Métricas Generales</h1>
        <p className="text-sm text-muted-foreground">Un resumen de la actividad de la plataforma en tiempo real.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-terracotta/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
              <Users className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Comunidad</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{totalUsers ?? 0}</p>
          <p className="text-sm font-medium text-blue-600/80 dark:text-blue-400/80">{totalSellers ?? 0} vendedores activos</p>
          <div className="absolute right-0 bottom-0 opacity-5 group-hover:opacity-10 transition-opacity translate-x-1/4 translate-y-1/4">
            <Users className="w-24 h-24" />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-terracotta/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-terracotta/10 text-terracotta">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Inventario</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1">{activeProducts ?? 0}</p>
          <p className="text-sm font-medium text-terracotta/80">Publicaciones disponibles</p>
          <div className="absolute right-0 bottom-0 opacity-5 group-hover:opacity-10 transition-opacity translate-x-1/4 translate-y-1/4">
            <Package className="w-24 h-24" />
          </div>
        </div>

        {isFullAdmin && (
          <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-terracotta/30 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-emerald-trust/10 text-emerald-trust">
                <Handshake className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Transacciones</span>
            </div>
            <p className="text-3xl font-heading font-bold mb-1 tabular-nums">{totalSales}</p>
            <p className="text-sm font-medium text-emerald-trust/80">{formatPrice(totalValue)} vol. histórico</p>
            <div className="absolute right-0 bottom-0 opacity-5 group-hover:opacity-10 transition-opacity translate-x-1/4 translate-y-1/4">
              <Handshake className="w-24 h-24" />
            </div>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-white dark:bg-neutral-900 p-5 shadow-sm group hover:border-terracotta/30 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Rendimiento Mes</span>
          </div>
          <p className="text-3xl font-heading font-bold mb-1 tabular-nums">{monthCount}</p>
          <p className="text-sm font-medium text-purple-600/80 dark:text-purple-400/80">Ventas completadas</p>
          <div className="absolute right-0 bottom-0 opacity-5 group-hover:opacity-10 transition-opacity translate-x-1/4 translate-y-1/4">
            <TrendingUp className="w-24 h-24" />
          </div>
        </div>
      </div>

      {/* Alerts */}
      {((pendingVerifications ?? 0) > 0 || (openDisputes ?? 0) > 0) && (
        <div className="space-y-4 pt-4 border-t border-border/40">
          <h2 className="font-heading font-semibold text-lg">Acción Requerida</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(pendingVerifications ?? 0) > 0 && (
              <a
                href="/admin/verifications"
                className="group flex items-center gap-4 rounded-2xl border border-amber-200/50 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/50 p-4 transition-all hover:shadow-md hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <div className="w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-200" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-2">
                    Verificaciones Pendientes
                    <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-xs">{pendingVerifications}</span>
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 group-hover:underline">Revisar solicitudes →</p>
                </div>
              </a>
            )}
            
            {(openDisputes ?? 0) > 0 && (
              <a
                href="/admin/disputes"
                className="group flex items-center gap-4 rounded-2xl border border-red-200/50 bg-red-50 dark:bg-red-900/20 dark:border-red-800/50 p-4 transition-all hover:shadow-md hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                <div className="w-10 h-10 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-200" />
                </div>
                <div>
                  <h3 className="font-semibold text-red-900 dark:text-red-100 flex items-center gap-2">
                    Disputas Abiertas
                    <span className="px-2 py-0.5 rounded-full bg-red-200 text-red-900 text-xs">{openDisputes}</span>
                  </h3>
                  <p className="text-sm text-red-700 dark:text-red-300 group-hover:underline">Resolver conflictos →</p>
                </div>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
