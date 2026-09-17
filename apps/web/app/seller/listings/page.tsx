import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, primaryCategorySlug } from "@vicino/shared";
import { priceFallbackLabel } from "@/lib/price-mode";
import { ListingActions } from "./listing-actions";
import { Plus } from "lucide-react";

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
    .select("id, titulo, precio, modo_precio, estatus, categoria, slug, ventas_count, vistas_count, created_at, product_categories(is_primary, categories(slug))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <h1 className="text-xl font-bold truncate min-w-0">Mis publicaciones</h1>
        <Link
          href="/vender"
          className="shrink-0 rounded-xl bg-[#4A7970] w-10 h-10 flex items-center justify-center text-white hover:opacity-90 active:scale-95 transition-all shadow-xs"
          title="Publicar nuevo"
          aria-label="Publicar nuevo"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
        </Link>
      </div>

      {products && products.length > 0 ? (
        <div className="space-y-3">
          {products.map((p) => {
            const estatus = p.estatus;
            if (estatus === null) return null;

            return (
              <div
                key={p.id}
                className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4 sm:p-5 flex flex-row items-center justify-between gap-4 overflow-hidden min-w-0 shadow-[0_8px_24px_rgba(0,0,0,0.07),0_2px_6px_rgba(0,0,0,0.04)] transition-shadow"
              >
                <div className="flex flex-col min-w-0 space-y-1">
                  <Link
                    href={`/${primaryCategorySlug(p.product_categories) ?? p.categoria}/${p.slug}`}
                    className="font-bold text-sm sm:text-base text-[color:var(--fg)] hover:underline truncate uppercase tracking-wide"
                  >
                    {p.titulo}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-[color:var(--fg-muted)] font-medium">
                    <span className="font-semibold text-[color:var(--fg)]">
                      {formatPrice(p.precio) ?? priceFallbackLabel(p.modo_precio)}
                    </span>
                    {p.created_at && (
                      <>
                        <span className="text-neutral-400 dark:text-neutral-600">|</span>
                        <span>
                          {new Date(p.created_at).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 pl-2">
                  <ListingActions id={p.id} estatus={estatus} />
                </div>
              </div>
            );
          })}
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
