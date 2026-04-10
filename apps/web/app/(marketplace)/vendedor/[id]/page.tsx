import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { ProductCard } from "@/components/product/product-card";
import {
  MessageCircle,
  ShieldCheck,
  Star,
  ShoppingBag,
  Calendar,
} from "lucide-react";
import type { TrustLevel } from "@vicino/shared";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("nombre, nombre_negocio, bio")
    .eq("id", id)
    .eq("es_vendedor", true)
    .single();

  if (!data) return { title: "Vendedor no encontrado" };

  return {
    title: data.nombre_negocio ?? data.nombre,
    description: data.bio?.slice(0, 160),
  };
}

export default async function VendorProfilePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // 1. Perfil del vendedor
  const { data: vendor } = await supabase
    .from("profiles")
    .select(
      `id, nombre, foto, bio, nombre_negocio, descripcion_negocio,
       metodos_pago_aceptados, trust_level, trust_points,
       average_rating_as_seller, reviews_count_as_seller, total_sales,
       is_verified, created_at`
    )
    .eq("id", id)
    .eq("es_vendedor", true)
    .single();

  if (!vendor) notFound();

  // 2. Listings activos del vendedor
  const { data: listings } = await supabase
    .from("products_services")
    .select(
      `id, titulo, precio, imagen_principal, categoria, slug,
       profiles!inner(nombre, trust_level, average_rating_as_seller, reviews_count_as_seller)`
    )
    .eq("creador_id", id)
    .eq("estatus", "disponible")
    .order("created_at", { ascending: false })
    .limit(12);

  // 3. Reviews del vendedor
  const { data: reviews } = await supabase
    .from("reviews")
    .select(
      `id, rating, comentario, created_at,
       profiles!reviewer_id(nombre, foto)`
    )
    .eq("reviewed_id", id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const memberSince = new Date(vendor.created_at).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8 animate-fade-in">
      {/* ─── HEADER DEL VENDEDOR ──────────────────────────────── */}
      <div className="rounded-3xl bg-card border border-border/40 overflow-hidden">
        {/* Banner / cover */}
        <div className="h-24 bg-gradient-to-br from-terracotta/15 via-cream-dark to-emerald-trust/10" />

        <div className="px-6 pb-6">
          {/* Avatar + badge */}
          <div className="relative -mt-12 mb-4">
            <div className="relative w-20 h-20 rounded-2xl bg-cream-dark dark:bg-neutral-800 border-4 border-card overflow-hidden shadow-md">
              {vendor.foto ? (
                <Image
                  src={vendor.foto}
                  alt={vendor.nombre}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-3xl font-heading font-bold text-terracotta">
                  {vendor.nombre.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {vendor.is_verified && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-trust flex items-center justify-center border-2 border-card">
                <ShieldCheck className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>

          {/* Nombre + negocio */}
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h1 className="font-heading font-bold text-2xl">
                {vendor.nombre_negocio ?? vendor.nombre}
              </h1>
              {vendor.nombre_negocio && (
                <p className="text-sm text-muted-foreground">{vendor.nombre}</p>
              )}
              <div className="mt-1.5">
                <SellerBadge
                  level={vendor.trust_level as TrustLevel}
                  showLabel
                  size="md"
                />
              </div>
            </div>

            {/* CTA mensaje — sticky en mobile */}
            <Link
              href={`/chat?seller=${vendor.id}`}
              className="flex items-center gap-2 rounded-xl bg-terracotta hover:bg-terracotta-dark text-white font-semibold px-5 py-2.5 text-sm transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.97]"
            >
              <MessageCircle className="w-4 h-4" />
              Enviar mensaje
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 py-4 border-y border-border/40">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                <span className="font-heading font-bold text-lg">
                  {Number(vendor.average_rating_as_seller).toFixed(1)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {vendor.reviews_count_as_seller} reseña
                {vendor.reviews_count_as_seller !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-center border-x border-border/40">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <ShoppingBag className="w-4 h-4 text-terracotta" />
                <span className="font-heading font-bold text-lg">
                  {vendor.total_sales}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">ventas</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="font-heading font-bold text-sm leading-tight text-center">
                  {memberSince}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">miembro</p>
            </div>
          </div>

          {/* Bio / descripción del negocio */}
          {(vendor.descripcion_negocio ?? vendor.bio) && (
            <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
              {vendor.descripcion_negocio ?? vendor.bio}
            </p>
          )}

          {/* Métodos de pago */}
          {vendor.metodos_pago_aceptados && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Pago: </span>
                {vendor.metodos_pago_aceptados}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── LISTINGS DEL VENDEDOR ───────────────────────────── */}
      <div>
        <h2 className="font-heading font-semibold text-xl mb-4">
          Publicaciones activas
        </h2>

        {listings && listings.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {listings.map((listing) => {
              const profile = Array.isArray(listing.profiles)
                ? listing.profiles[0]
                : listing.profiles;
              return (
                <ProductCard
                  key={listing.id}
                  id={listing.id}
                  titulo={listing.titulo}
                  precio={Number(listing.precio)}
                  imagen={listing.imagen_principal}
                  categoria={listing.categoria}
                  slug={listing.slug ?? listing.id}
                  vendedor={{
                    nombre: profile?.nombre ?? vendor.nombre,
                    trust_level: (profile?.trust_level as TrustLevel) ?? "nuevo",
                  }}
                  rating={Number(profile?.average_rating_as_seller ?? 0)}
                  reviewsCount={Number(profile?.reviews_count_as_seller ?? 0)}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 rounded-2xl border border-dashed border-border">
            <p className="text-4xl mb-2">🏪</p>
            <p className="text-sm text-muted-foreground">
              Este vendedor aún no tiene publicaciones activas
            </p>
          </div>
        )}
      </div>

      {/* ─── RESEÑAS ─────────────────────────────────────────── */}
      {reviews && reviews.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-heading font-semibold text-xl">Reseñas</h2>
            <RatingStars
              rating={Number(vendor.average_rating_as_seller)}
              count={vendor.reviews_count_as_seller}
              size="sm"
            />
          </div>

          <div className="space-y-3">
            {reviews.map((review) => {
              const reviewer = Array.isArray(review.profiles)
                ? review.profiles[0]
                : review.profiles;
              return (
                <div
                  key={review.id}
                  className="rounded-2xl bg-card border border-border/40 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-cream-dark dark:bg-neutral-800 flex items-center justify-center text-sm font-semibold text-terracotta overflow-hidden">
                        {reviewer?.foto ? (
                          <Image
                            src={reviewer.foto}
                            alt={reviewer.nombre ?? ""}
                            width={32}
                            height={32}
                            className="object-cover"
                          />
                        ) : (
                          (reviewer?.nombre?.charAt(0) ?? "U").toUpperCase()
                        )}
                      </div>
                      <span className="text-sm font-medium">
                        {reviewer?.nombre ?? "Comprador"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${
                            i < review.rating
                              ? "text-yellow-500 fill-yellow-500"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {review.comentario && (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {review.comentario}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground/60">
                    {new Date(review.created_at).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
