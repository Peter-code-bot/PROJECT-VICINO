import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatDate, primaryCategorySlug } from "@vicino/shared";
import { ListingActions } from "./listing-actions";

export const metadata = { title: "Mis publicaciones" };

export default async function ListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // MP#08 #4 Fase 1B: SELECT incluye product_categories embed (solo slug)
  // para derivar el segmento de href via primaryCategorySlug. Sin nombre
  // porque este listing no muestra label de categoria (solo el href).
  const { data: products } = await supabase
    .from("products_services")
    .select("id, titulo, precio, estatus, categoria, slug, ventas_count, vistas_count, created_at, product_categories(is_primary, categories(slug))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("created_at", { ascending: false });

  const statusColors: Record<string, string> = {
    disponible:
      "bg-[color:var(--brand-tint)] text-[color:var(--trust-emerald)] border border-[color:var(--trust-emerald)]/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
    pausado:
      "bg-amber-400/10 text-amber-400 border border-amber-400/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
    borrador:
      "bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] border border-[color:var(--border)] rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
    agotado:
      "bg-[color:var(--danger)]/10 text-[color:var(--danger)] border border-[color:var(--danger)]/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <h1 className="text-xl font-bold truncate min-w-0">Mis publicaciones</h1>
        <Link
          href="/vender"
          className="shrink-0 rounded-[var(--r-pill)] bg-[color:var(--brand)] px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white hover:bg-[color:var(--brand-dark)] whitespace-nowrap transition-colors"
        >
          <span className="hidden sm:inline">Publicar nuevo</span>
          <span className="sm:hidden">Publicar</span>
        </Link>
      </div>

      {products && products.length > 0 ? (
        <div className="space-y-3">
          {products.map((p) => (
            <div
              key={p.id}
              className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 hover:shadow-[var(--shadow-sm)] transition-all flex flex-row items-center justify-between gap-3 overflow-hidden min-w-0"
            >
              <div className="flex flex-col min-w-0 space-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    href={`/${primaryCategorySlug((p as { product_categories?: unknown }).product_categories) ?? p.categoria}/${p.slug}`}
                    className="font-medium text-sm text-[color:var(--fg)] hover:underline truncate"
                  >
                    {p.titulo}
                  </Link>
                </div>
                <div className="flex items-center gap-2 text-xs text-[color:var(--fg-muted)] flex-wrap">
                  <span className={`shrink-0 ${statusColors[p.estatus] ?? ""}`}>
                    {p.estatus}
                  </span>
                  <span className="shrink-0 font-medium text-[color:var(--trust-emerald)]">{formatPrice(Number(p.precio))}</span>
                  <span className="shrink-0">{new Date(p.created_at).toLocaleDateString('es-MX', {day: '2-digit', month: '2-digit', year: '2-digit'})}</span>
                </div>
              </div>
              <div className="shrink-0 pl-2">
                <ListingActions id={p.id} estatus={p.estatus} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">📦</p>
          <p className="font-medium">Sin publicaciones</p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Publica tu primer producto o servicio
          </p>
        </div>
      )}
    </div>
  );
}
