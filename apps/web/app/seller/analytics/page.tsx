import { redirect } from "next/navigation";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { CANALES_ENLACE_NEGOCIO, type CanalEnlaceNegocio } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import dynamic from "next/dynamic";
import { SkeletonPanel } from "@/components/shared/loading-skeletons";

/**
 * recharts pesa 379.377 B sin comprimir (112.827 B gzip) y es el 43 % de los
 * bytes de esta ruta. Con el import estatico viajaba en el chunk de la pagina,
 * asi que el vendedor no veia NADA —ni los numeros, que ya vienen resueltos del
 * servidor— hasta que terminaba de bajarse la libreria de graficas.
 *
 * Cargandolo asi, las cifras y las tablas se pintan de inmediato y la grafica
 * aterriza despues, sobre su esqueleto. Es el unico sitio del repo que importa
 * recharts, comprobado con grep, asi que el chunk sale limpio.
 */
const AnalyticsCharts = dynamic(
  () => import("./analytics-charts").then((m) => m.AnalyticsCharts),
  { loading: () => <SkeletonPanel etiqueta="Cargando las graficas" /> },
);

export const metadata = { title: "Estadísticas" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sales last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentSales } = await supabase
    .from("sale_confirmations")
    .select("completed_at, precio_acordado, products_services(titulo)")
    .eq("seller_id", user.id)
    .eq("status", "completed")
    .gte("completed_at", thirtyDaysAgo.toISOString())
    .order("completed_at", { ascending: true });

  // Aggregate by day
  const salesByDay: Record<string, number> = {};
  const productSales: Record<string, number> = {};

  recentSales?.forEach((s) => {
    if (s.completed_at) {
      const day = s.completed_at.slice(0, 10);
      salesByDay[day] = (salesByDay[day] ?? 0) + 1;
    }
    const product = Array.isArray(s.products_services)
      ? s.products_services[0]
      : s.products_services;
    const name = product?.titulo ?? "Producto";
    productSales[name] = (productSales[name] ?? 0) + 1;
  });

  const dailyData = Object.entries(salesByDay).map(([date, count]) => ({
    date,
    ventas: count,
  }));

  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, ventas: count }));

  // Clics a los enlaces externos del negocio, por canal. RLS deja ver solo los
  // propios. Un conteo por canal (head: true) y no una fila por clic: PostgREST
  // corta en 1000 filas y el total saldria truncado en silencio. Un clic es una
  // apertura del enlace y nada mas: no sabemos si hubo mensaje ni venta, y la
  // pantalla lo dice en voz alta.
  const conteos = await Promise.all(
    CANALES_ENLACE_NEGOCIO.map((canal) =>
      supabase
        .from("clics_enlaces_negocio")
        .select("id", { count: "exact", head: true })
        .eq("vendedor_id", user.id)
        .eq("canal", canal)
        .gte("created_at", thirtyDaysAgo.toISOString()),
    ),
  );
  const errorClics = conteos.find((c) => c.error)?.error;
  if (errorClics) {
    // Un fallo no se pinta como cero: cero es un dato y esto no lo es.
    Sentry.captureException(errorClics, {
      tags: { surface: "seller-analytics", query: "clics_enlaces_negocio" },
      contexts: { supabase: { code: errorClics.code } },
    });
  }
  const clicsPorCanal = Object.fromEntries(
    CANALES_ENLACE_NEGOCIO.map((canal, i) => [canal, errorClics ? null : (conteos[i]?.count ?? 0)]),
  ) as Record<CanalEnlaceNegocio, number | null>;

  return (
    <div className="space-y-6 min-w-0">
      <h1 className="text-xl font-bold truncate">Estadísticas</h1>
      <div className="w-full min-w-0">
        <AnalyticsCharts dailyData={dailyData} topProducts={topProducts} />
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Clics a tus enlaces (últimos 30 días)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ETIQUETAS_CANAL.map(([canal, etiqueta]) => (
            <div key={canal} className="rounded-2xl bg-card p-4 shadow-sm">
              <p className="text-2xl font-heading font-bold leading-none">
                {clicsPorCanal[canal] ?? <span aria-label="No disponible">—</span>}
              </p>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">{etiqueta}</p>
            </div>
          ))}
        </div>
        {errorClics ? (
          <p className="text-xs text-destructive" role="status">
            No pudimos cargar los clics ahora. Recarga en un momento.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Un clic solo dice que alguien abrió el enlace desde tu perfil: no es un mensaje ni una venta.
          Es un conteo orientativo, con topes contra abusos. Tus enlaces se configuran en{" "}
          <Link href="/perfil/editar" className="underline underline-offset-4">Editar perfil</Link>.
        </p>
      </section>
    </div>
  );
}

const ETIQUETAS_CANAL: ReadonlyArray<readonly [CanalEnlaceNegocio, string]> = [
  ["instagram", "Instagram"],
  ["whatsapp", "WhatsApp"],
  ["google_maps", "Google Maps"],
  ["google_resenas", "Reseña en Google"],
];
