import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product/product-card";
import { SearchFilters } from "./search-filters";
import { CATEGORIES } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    price_min?: string;
    price_max?: string;
    tipo?: string;
    sort?: string;
    lat?: string;
    lng?: string;
    radio?: string;
  }>;
}

export const metadata = {
  title: "Buscar",
};

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();

  const lat = params.lat ? parseFloat(params.lat) : null;
  const lng = params.lng ? parseFloat(params.lng) : null;
  const radio = params.radio ? parseInt(params.radio) : 5000;
  const hasGeo = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

  // Modo geo-proximal: sin texto → usar RPC para resultados ordenados por distancia
  const useGeoMode = hasGeo && !params.q;

  let products: Array<{
    id: string;
    titulo: string;
    precio: number;
    imagen_principal: string | null;
    categoria: string;
    slug: string | null;
    profiles: { nombre: string; trust_level: string; average_rating_as_seller: number; reviews_count_as_seller: number } | null;
  }> | null = null;

  if (useGeoMode) {
    const { data: rpcData } = await supabase.rpc("nearby_products", {
      user_lat: lat,
      user_lng: lng,
      radius_meters: radio,
      category_filter: params.category ?? null,
      result_limit: 40,
    });
    // Normalizar forma del RPC al shape esperado por ProductCard
    products = (rpcData ?? []).map((p: {
      id: string; titulo: string; precio: number; imagen_principal: string | null;
      categoria: string; slug: string; vendedor_nombre: string; vendedor_trust: string;
      vendedor_rating: number; vendedor_reviews: number;
    }) => ({
      id: p.id,
      titulo: p.titulo,
      precio: p.precio,
      imagen_principal: p.imagen_principal,
      categoria: p.categoria,
      slug: p.slug,
      profiles: {
        nombre: p.vendedor_nombre,
        trust_level: p.vendedor_trust,
        average_rating_as_seller: p.vendedor_rating,
        reviews_count_as_seller: p.vendedor_reviews,
      },
    }));
  } else {
    let query = supabase
      .from("products_services")
      .select(
        `
        id, titulo, precio, imagen_principal, categoria, slug,
        profiles!inner(nombre, trust_level, average_rating_as_seller, reviews_count_as_seller)
      `
      )
      .eq("estatus", "disponible");

    // Full-text search
    if (params.q) {
      query = query.textSearch("search_vector", params.q, {
        type: "websearch",
        config: "spanish",
      });
    }

    // Category filter
    if (params.category) {
      query = query.eq("categoria", params.category);
    }

    // Type filter
    if (params.tipo === "producto" || params.tipo === "servicio") {
      query = query.eq("tipo", params.tipo);
    }

    // Price range
    if (params.price_min) {
      query = query.gte("precio", Number(params.price_min));
    }
    if (params.price_max) {
      query = query.lte("precio", Number(params.price_max));
    }

    // Sort
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

    const { data } = await query.limit(40);
    products = data as typeof products;
  }

  const categoryName = params.category
    ? CATEGORIES.find((c) => c.slug === params.category)?.name
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <SearchFilters
        initialQuery={params.q}
        initialCategory={params.category}
        initialSort={params.sort}
        initialTipo={params.tipo}
        initialPriceMin={params.price_min}
        initialPriceMax={params.price_max}
        initialLat={params.lat}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {products?.length ?? 0} resultado{products?.length !== 1 ? "s" : ""}
          {params.q && ` para "${params.q}"`}
          {categoryName && ` en ${categoryName}`}
          {useGeoMode && ` · ordenados por cercanía`}
        </p>
      </div>

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
                rating={Number(profile?.average_rating_as_seller ?? 0)}
                reviewsCount={Number(profile?.reviews_count_as_seller ?? 0)}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 space-y-2">
          <p className="text-4xl">🔍</p>
          <p className="font-medium">No se encontraron resultados</p>
          <p className="text-sm text-muted-foreground">
            Intenta con otros términos o filtros
          </p>
        </div>
      )}
    </div>
  );
}
