import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product/product-card";
import { SearchFilters } from "./search-filters";
import { CATEGORIES } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";
import { ChevronLeft, ChevronRight, User, Star, ShieldCheck } from "lucide-react";

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    price_min?: string;
    price_max?: string;
    tipo?: string;
    sort?: string;
    page?: string;
  }>;
}

export const metadata = {
  title: "Buscar",
};

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const currentPage = Math.max(1, Number(params.page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  let query = supabase
    .from("products_services")
    .select(
      `
      id, titulo, precio, imagen_principal, categoria, slug, precio_negociable,
      profiles!inner(nombre, trust_level, average_rating, reviews_count)
    `,
      { count: "exact" }
    )
    .eq("estatus", "disponible");

  let topUsers: any[] = [];
  if (params.q) {
    const unaccentedLike = params.q.replace(/[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/g, "_");

    // Buscamos vendedores que coincidan con la búsqueda (ignorando acentos)
    const { data: sellers } = await supabase
      .from("profiles")
      .select("id, nombre, avatar_url, trust_level, average_rating, reviews_count")
      .ilike("nombre", `%${unaccentedLike}%`)
      .limit(4);

    if (sellers) {
      topUsers = sellers;
    }

    const sellerIds = topUsers.map((s) => s.id);

    // Buscamos en titulo y descripcion, o si el producto pertenece a un vendedor coincidente
    let orQuery = `titulo.ilike.%${unaccentedLike}%,descripcion.ilike.%${unaccentedLike}%`;
    if (sellerIds.length > 0) {
      orQuery += `,creador_id.in.(${sellerIds.join(",")})`;
    }

    query = query.or(orQuery);
  }
  if (params.category) {
    // MP#08 #5b: el filtro de categoria lee del pivote product_categories
    // (1 fila por producto hoy; multi-categoria es scope futuro #5c) en vez
    // de la columna categoria TEXT denormalizada. La columna TEXT sigue
    // intacta para el render path (URLs, breadcrumbs, badges, carrusel del
    // home) y su drop es MP#08 #4. El validator enum (commit 4036993)
    // garantiza que un categoria que llega del form/dropdown es un slug
    // canonico; el maybeSingle + branch de cero resultados defiende del
    // caso de URL manipulada con slug inexistente.
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.category)
      .maybeSingle();

    if (cat) {
      const { data: pivotRows } = await supabase
        .from("product_categories")
        .select("product_id")
        .eq("categoria_id", cat.id);

      const ids = (pivotRows ?? []).map((r) => r.product_id);
      if (ids.length > 0) {
        query = query.in("id", ids);
      } else {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    } else {
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }
  if (params.tipo === "producto" || params.tipo === "servicio") {
    query = query.eq("tipo", params.tipo);
  }
  if (params.price_min) {
    query = query.gte("precio", Number(params.price_min));
  }
  if (params.price_max) {
    query = query.lte("precio", Number(params.price_max));
  }

  switch (params.sort) {
    case "price_asc":
      query = query.order("precio", { ascending: true });
      break;
    case "price_desc":
      query = query.order("precio", { ascending: false });
      break;
    case "most_sold":
      query = query.order("ventas_count", { ascending: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data: products, count: totalCount } = await query.range(
    offset,
    offset + PAGE_SIZE - 1
  );

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE);
  const categoryName = params.category
    ? CATEGORIES.find((c) => c.slug === params.category)?.name
    : null;

  // Build pagination URL helper
  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.category) p.set("category", params.category);
    if (params.tipo) p.set("tipo", params.tipo);
    if (params.price_min) p.set("price_min", params.price_min);
    if (params.price_max) p.set("price_max", params.price_max);
    if (params.sort) p.set("sort", params.sort);
    if (page > 1) p.set("page", String(page));
    return `/buscar?${p.toString()}`;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4">
      <SearchFilters
        initialQuery={params.q}
        initialCategory={params.category}
        initialSort={params.sort}
        initialTipo={params.tipo}
        initialPriceMin={params.price_min}
        initialPriceMax={params.price_max}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-[color:var(--fg-muted)]">
          <span className="font-semibold text-[color:var(--fg)]">
            {totalCount ?? 0}
          </span>{" "}
          resultado{totalCount !== 1 ? "s" : ""}
          {params.q && (
            <>
              {" "}para{" "}
              <span className="text-[color:var(--brand-hi)]">
                &ldquo;{params.q}&rdquo;
              </span>
            </>
          )}
          {categoryName && (
            <>
              {" "}en{" "}
              <span className="text-[color:var(--fg)]">{categoryName}</span>
            </>
          )}
        </p>
        {totalPages > 1 && (
          <p className="text-xs text-[color:var(--fg-dim)]">
            Página {currentPage} de {totalPages}
          </p>
        )}
      </div>

      {topUsers.length > 0 && currentPage === 1 && (
        <div className="space-y-3 mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--fg)] uppercase tracking-wide">Usuarios encontrados</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topUsers.map((user) => (
              <Link
                key={user.id}
                href={`/tienda/${user.id}`}
                className="flex items-center gap-4 p-3 rounded-2xl bg-[color:var(--card-2)] hover:bg-[color:var(--card)] border border-[color:var(--border)] transition-all group"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                  {user.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatar_url} alt={user.nombre ?? "Usuario"} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-sm text-[color:var(--fg)] group-hover:text-[color:var(--brand-hi)] transition-colors truncate">
                      {user.nombre}
                    </h3>
                    {user.trust_level === "verificado" && (
                      <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--brand)] flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-xs font-medium text-[color:var(--fg)]">
                    <Star className="w-3 h-3 fill-[color:var(--brand)] text-[color:var(--brand)]" />
                    <span>{Number(user.average_rating || 0).toFixed(1)}</span>
                    <span className="text-[color:var(--fg-muted)] font-normal">
                      ({user.reviews_count || 0})
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[color:var(--fg-muted)] opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {products && products.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {products.map((product) => {
            const profile = Array.isArray(product.profiles)
              ? product.profiles[0]
              : product.profiles;
            return (
              <ProductCard
                key={product.id}
                id={product.id}
                titulo={product.titulo}
                precio={Number(product.precio)}
                imagen={product.imagen_principal}
                categoria={product.categoria}
                slug={product.slug ?? product.id}
                vendedor={{
                  nombre: profile?.nombre ?? "Vendedor",
                  trust_level: (profile?.trust_level as TrustLevel) ?? "nuevo",
                }}
                rating={Number(profile?.average_rating ?? 0)}
                reviewsCount={Number(profile?.reviews_count ?? 0)}
                precioNegociable={product.precio_negociable ?? false}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 py-16 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--brand-tint)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
            <span className="text-3xl">🔍</span>
          </div>
          <p className="font-heading text-base font-semibold text-[color:var(--fg)]">
            No se encontraron resultados
          </p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Intenta con otros términos o filtros
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {currentPage > 1 ? (
            <Link
              href={pageUrl(currentPage - 1)}
              className="inline-flex items-center gap-1 rounded-xl bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-all hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium text-[color:var(--fg-dim)] shadow-[inset_0_0_0_1px_var(--border)]">
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </span>
          )}

          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) {
                page = i + 1;
              } else if (currentPage <= 3) {
                page = i + 1;
              } else if (currentPage >= totalPages - 2) {
                page = totalPages - 4 + i;
              } else {
                page = currentPage - 2 + i;
              }
              return (
                <Link
                  key={page}
                  href={pageUrl(page)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                    page === currentPage
                      ? "bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)]"
                      : "text-[color:var(--fg-muted)] hover:bg-[color:var(--brand-tint)] hover:text-[color:var(--brand-hi)]"
                  }`}
                  aria-current={page === currentPage ? "page" : undefined}
                >
                  {page}
                </Link>
              );
            })}
          </div>

          {currentPage < totalPages ? (
            <Link
              href={pageUrl(currentPage + 1)}
              className="inline-flex items-center gap-1 rounded-xl bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-all hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium text-[color:var(--fg-dim)] shadow-[inset_0_0_0_1px_var(--border)]">
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
