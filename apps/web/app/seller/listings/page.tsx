import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatDate } from "@vicino/shared";
import { ListingActions } from "./listing-actions";

export const metadata = { title: "Mis publicaciones" };

export default async function ListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: products } = await supabase
    .from("products_services")
    .select("id, titulo, precio, estatus, categoria, slug, ventas_count, vistas_count, created_at")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("created_at", { ascending: false });

  const statusColors: Record<string, string> = {
    disponible: "bg-emerald-trust/10 text-emerald-trust",
    pausado: "bg-warning/10 text-warning",
    borrador: "bg-muted text-muted-foreground",
    agotado: "bg-danger/10 text-danger",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold truncate">Mis publicaciones</h1>
        <Link
          href="/vender"
          className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 whitespace-nowrap"
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
              className="rounded-lg border p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    href={`/${p.categoria}/${p.slug}`}
                    className="font-medium text-sm hover:underline truncate min-w-0"
                  >
                    {p.titulo}
                  </Link>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[p.estatus] ?? ""}`}
                  >
                    {p.estatus}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatPrice(Number(p.precio))}</span>
                  <span>{p.ventas_count} ventas</span>
                  <span>{p.vistas_count} vistas</span>
                  <span>{formatDate(p.created_at)}</span>
                </div>
              </div>
              <ListingActions id={p.id} estatus={p.estatus} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">📦</p>
          <p className="font-medium">Sin publicaciones</p>
          <p className="text-sm text-muted-foreground">
            Publica tu primer producto o servicio
          </p>
        </div>
      )}
    </div>
  );
}
