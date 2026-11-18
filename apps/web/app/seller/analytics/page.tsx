import { redirect } from "next/navigation";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import {
  CANALES_ENLACE_NEGOCIO,
  ETIQUETAS_CANAL_ENLACE_NEGOCIO,
  listarEnlacesNegocio,
  type CanalEnlaceNegocio,
} from "@vicino/shared";
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

  // Clics a los enlaces externos del negocio, por canal, en UNA consulta
  // (clics_enlaces_negocio_por_canal, 20261108230000: count agrupado, sin el
  // tope de 1000 filas de PostgREST). RLS deja ver solo los propios. Un clic es
  // una apertura del enlace y nada mas: no sabemos si hubo mensaje ni venta, y
  // la pantalla lo dice en voz alta.
  const [{ data: conteos, error: errorClics }, { data: enlacesPropios }] = await Promise.all([
    supabase.rpc("clics_enlaces_negocio_por_canal", { p_dias: 30 }),
    supabase
      .from("profiles")
      .select(
        "instagram_usuario, whatsapp_numero, google_maps_url, google_resenas_url, facebook_ruta, facebook_messenger, tiktok_usuario, youtube_ruta, x_usuario, linkedin_ruta, threads_usuario, pinterest_usuario, telegram_usuario",
      )
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  if (errorClics) {
    // Un fallo no se pinta como cero: cero es un dato y esto no lo es.
    Sentry.captureException(errorClics, {
      tags: { surface: "seller-analytics", query: "clics_enlaces_negocio_por_canal" },
      contexts: { supabase: { code: errorClics.code } },
    });
  }
  const clicsPorCanal = new Map<string, number>((conteos ?? []).map((fila) => [fila.canal, Number(fila.clics)]));
  // Con trece canales, solo los que importan: los que el negocio tiene puestos
  // hoy y los que recibieron clics en estos 30 dias (aunque ya los haya quitado).
  const configurados = new Set<CanalEnlaceNegocio>(
    listarEnlacesNegocio(enlacesPropios, { incluirResenas: true }).map((enlace) => enlace.canal),
  );
  const canalesAMostrar = CANALES_ENLACE_NEGOCIO.filter(
    (canal) => configurados.has(canal) || (clicsPorCanal.get(canal) ?? 0) > 0,
  );

  return (
    <div className="space-y-6 min-w-0">
      <h1 className="text-xl font-bold truncate">Estadísticas</h1>
      <div className="w-full min-w-0">
        <AnalyticsCharts dailyData={dailyData} topProducts={topProducts} />
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Clics a tus enlaces (últimos 30 días)</h2>
        {canalesAMostrar.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tienes enlaces de contacto ni redes en tu perfil.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {canalesAMostrar.map((canal) => (
            <div key={canal} className="rounded-2xl bg-card p-4 shadow-sm">
              <p className="text-2xl font-heading font-bold leading-none">
                {errorClics ? <span aria-label="No disponible">—</span> : (clicsPorCanal.get(canal) ?? 0)}
              </p>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                {ETIQUETAS_CANAL_ENLACE_NEGOCIO[canal]}
              </p>
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

