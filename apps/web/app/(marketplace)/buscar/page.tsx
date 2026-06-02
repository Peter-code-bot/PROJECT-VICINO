import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product/product-card";
import { SearchFilters } from "./search-filters";
import { CATEGORIES, normalizeCardCategories } from "@vicino/shared";
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

  // MP#08 #5c-3: incluimos created_at + ventas_count en el SELECT para que
  // el sortFn de la rama category pueda aplicar los 4 criterios de orden
  // (price_asc/desc, most_sold, default created_at desc) DENTRO de cada
  // tier (primary sorted + secondary sorted, concat). En la rama
  // no-category Postgres usa estas columnas via .order() como siempre.
  let query = supabase
    .from("products_services")
    .select(
      `
      id, titulo, precio, imagen_principal, categoria, slug, precio_negociable,
      created_at, ventas_count,
      profiles!inner(nombre, trust_level, average_rating, reviews_count),
      product_categories(is_primary, categories(slug, nombre))
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
  // MP#08 #5c-3: cuando hay filtro de categoria, el orden de los resultados
  // se decide por el ranking primary > secondary del pivote (no por el
  // sort de Postgres). orderedIds se llena en la rama if-category con la
  // concatenacion de primary IDs primero + secondary IDs despues, y mas
  // abajo el SELECT principal lo aplica via .in() + particion + sort JS.
  // primaryIds se expone aqui (no solo dentro del if cat) porque la rama
  // de SELECT/sort de abajo lo necesita para particionar el conjunto de
  // productos en tiers antes de aplicar el sort user-seleccionado.
  let orderedIds: string[] | null = null;
  let primaryIds: string[] = [];

  if (params.category) {
    // MP#08 #5c-3 (sobre el read switch 5b 52c477a): dos queries paralelas
    // al pivote, una con is_primary=true y otra con is_primary=false. La
    // concatenacion primary-first define el ranking final. Approach A del
    // Plan Mode #5c D6: 2 round-trips paralelos en lugar de 1 con embed
    // ordering (PostgREST tiene quirks documentados ordenando por columna
    // de join). El validator enum (4036993) garantiza que un slug del form
    // es canonico; el maybeSingle defiende del caso de URL manipulada.
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.category)
      .maybeSingle();

    if (cat) {
      const [primariesRes, secondariesRes] = await Promise.all([
        supabase
          .from("product_categories")
          .select("product_id")
          .eq("categoria_id", cat.id)
          .eq("is_primary", true),
        supabase
          .from("product_categories")
          .select("product_id")
          .eq("categoria_id", cat.id)
          .eq("is_primary", false),
      ]);

      primaryIds = (primariesRes.data ?? []).map((r) => r.product_id);
      const secondaryIds = (secondariesRes.data ?? []).map((r) => r.product_id);

      // Defensive dedupe: composite PK (product_id, categoria_id) garantiza
      // que un producto solo aparece UNA vez para una categoria dada, y
      // is_primary es una columna no parte del PK, por lo que un product_id
      // esta en a lo sumo UNA de las 2 listas (true XOR false). El Set es
      // belt-and-suspenders contra un schema drift futuro (DROP del PK,
      // RPC que duplique) y sin coste perceptible a 1..3 categorias.
      orderedIds = Array.from(new Set([...primaryIds, ...secondaryIds]));

      if (orderedIds.length > 0) {
        query = query.in("id", orderedIds);
      } else {
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    } else {
      orderedIds = [];
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

  // MP#08 #5c-3: el sort de Postgres y el .range() solo aplican cuando NO
  // hay filtro de categoria. Cuando hay categoria, el orden lo decide
  // primero el tier (primary > secondary) y dentro de cada tier se aplica
  // el sort user-seleccionado (price_asc/desc, most_sold, default
  // created_at desc) via sortFn. Tier ordering prevalece sobre sort.
  //
  // Tipos: derivamos ProductsData del retorno inferido de supabase-js
  // (.select(...) preserva el shape de columnas seleccionadas) para no
  // romper el binding tipado al ProductCard mas abajo.
  type ProductsData = Awaited<ReturnType<typeof query.range>>["data"];
  type ProductRow = NonNullable<ProductsData>[number];
  let products: ProductsData = null;
  let totalCount: number | null = null;

  // Helper sortFn: comparador segun el sort param. Mismas keys que el
  // .order() de la rama no-category, asi un slug sin category y un slug
  // con category producen ordenes equivalentes DENTRO de cada tier para
  // el mismo sort. Devuelve siempre una funcion (default = created_at desc).
  const sortFn = (sort?: string) => (a: ProductRow, b: ProductRow): number => {
    switch (sort) {
      case "price_asc":
        return Number(a.precio) - Number(b.precio);
      case "price_desc":
        return Number(b.precio) - Number(a.precio);
      case "most_sold":
        return Number(b.ventas_count ?? 0) - Number(a.ventas_count ?? 0);
      default:
        // created_at desc: el mas reciente primero.
        return a.created_at < b.created_at ? 1 : -1;
    }
  };

  if (orderedIds === null) {
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

    const res = await query.range(offset, offset + PAGE_SIZE - 1);
    products = res.data;
    totalCount = res.count ?? null;
  } else {
    // Rama category: traemos TODO lo que matchea (q, tipo, price) dentro
    // del .in(orderedIds), particionamos en 2 tiers via Set(primaryIds),
    // ordenamos cada tier con sortFn(params.sort), concatenamos y
    // paginamos en JS. Trade-off: para categorias muy grandes (>500
    // productos post-filtros) el payload server crece; hoy max ~57.
    const res = await query;
    const allProducts: ProductRow[] = res.data ?? [];

    const primarySet = new Set(primaryIds);
    const primaryGroup = allProducts.filter((p) => primarySet.has(p.id));
    const secondaryGroup = allProducts.filter((p) => !primarySet.has(p.id));

    const sorter = sortFn(params.sort);
    primaryGroup.sort(sorter);
    secondaryGroup.sort(sorter);

    const fullRanking = [...primaryGroup, ...secondaryGroup];
    totalCount = fullRanking.length;
    products = fullRanking.slice(offset, offset + PAGE_SIZE);
  }

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
          {products.map((product, index) => {
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
                categories={normalizeCardCategories(
                  (product as { product_categories?: unknown }).product_categories,
                )}
                priority={index === 0}
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
