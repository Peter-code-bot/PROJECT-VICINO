import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product/product-card";
import type { TrustLevel } from "@vicino/shared";
import { Heart } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Favoritos — VICINO" };

export default async function FavoritosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/favoritos");

  const { data: favorites } = await supabase
    .from("favorites")
    .select(
      `
      id,
      producto_id,
      products_services!inner(
        id, titulo, precio, imagen_principal, categoria, slug,
        profiles!inner(nombre, trust_level, average_rating_as_seller, reviews_count_as_seller)
      )
    `
    )
    .eq("usuario_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-heading font-bold mb-6">Mis favoritos</h1>

      {favorites && favorites.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {favorites.map((fav) => {
            const product = Array.isArray(fav.products_services)
              ? fav.products_services[0]
              : fav.products_services;
            if (!product) return null;
            const profile = Array.isArray(product.profiles)
              ? product.profiles[0]
              : product.profiles;
            return (
              <ProductCard
                key={fav.id}
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
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-50 dark:bg-red-950/20 flex items-center justify-center">
            <Heart className="w-8 h-8 text-red-300" />
          </div>
          <h2 className="font-heading font-bold text-lg mb-2">Sin favoritos</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Guarda productos que te interesen para verlos después
          </p>
          <Link
            href="/buscar"
            className="inline-flex rounded-xl bg-terracotta text-white px-4 py-2 text-sm font-medium hover:bg-terracotta/90"
          >
            Explorar productos
          </Link>
        </div>
      )}
    </div>
  );
}
