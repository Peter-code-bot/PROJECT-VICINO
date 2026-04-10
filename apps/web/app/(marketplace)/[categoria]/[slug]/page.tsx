import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { MessageCircle, Heart, MapPin, Truck, ShieldCheck, ChevronRight } from "lucide-react";
import { ImageGallery } from "@/components/product/image-gallery";
import type { TrustLevel } from "@vicino/shared";

interface Props {
  params: Promise<{ categoria: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products_services")
    .select("titulo, descripcion, imagen_principal, precio")
    .eq("slug", slug)
    .single();

  if (!product) return { title: "Producto no encontrado" };

  return {
    title: product.titulo,
    description: product.descripcion?.slice(0, 160),
    openGraph: {
      title: `${product.titulo} — VICINO`,
      description: product.descripcion?.slice(0, 160),
      images: product.imagen_principal ? [product.imagen_principal] : [],
    },
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products_services")
    .select(
      `
      *,
      profiles!inner(
        id, nombre, foto, trust_level, metodos_pago_aceptados,
        average_rating_as_seller, reviews_count_as_seller, total_sales
      )
    `
    )
    .eq("slug", slug)
    .eq("estatus", "disponible")
    .single();

  if (!product) notFound();

  const seller = Array.isArray(product.profiles)
    ? product.profiles[0]
    : product.profiles;

  // Get reviews for this product (buyer_to_seller only)
  const { data: reviews } = await supabase
    .from("reviews")
    .select(
      `
      id, rating, comentario, created_at, review_type, respuesta, respuesta_fecha,
      profiles!reviewer_id(nombre, foto, trust_level)
    `
    )
    .eq("product_id", product.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  // Get active coupons for this seller
  const { data: coupons } = await supabase
    .from("coupons")
    .select("codigo, tipo_descuento, valor")
    .eq("vendedor_id", product.creador_id)
    .eq("activo", true)
    .or("fecha_expiracion.is.null,fecha_expiracion.gt." + new Date().toISOString())
    .limit(5);

  // Increment view count (fire and forget)
  supabase
    .from("products_services")
    .update({ vistas_count: (product.vistas_count ?? 0) + 1 })
    .eq("id", product.id)
    .then();

  const deliveryLabel =
    product.tipo_entrega === "pickup"
      ? "Recoger en punto local"
      : product.tipo_entrega === "envio"
        ? "Envío disponible"
        : "Pickup o envío disponible";

  return (
    <div className="max-w-4xl mx-auto md:py-8 animate-fade-in">
      {/* Breadcrumbs (Desktop only) */}
      <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground mb-6 px-4">
        <Link href="/" className="hover:text-terracotta transition-colors">Inicio</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href={`/buscar?category=${product.categoria}`} className="hover:text-terracotta transition-colors capitalize">
          {product.categoria.replace("-", " ")}
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground truncate max-wxs">{product.titulo}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:px-4">
        {/* Left Column — Image Gallery */}
        <div className="relative">
          <ImageGallery
            imagenPrincipal={product.imagen_principal}
            galeriaImagenes={(product.galeria_imagenes as string[]) ?? []}
            titulo={product.titulo}
          />
          {/* Mobile Fav Button */}
          <button className="md:hidden absolute top-4 right-4 w-10 h-10 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-md flex items-center justify-center shadow-lg active:scale-95 transition-transform z-10">
            <Heart className="h-5 w-5 text-charcoal/80 dark:text-white/80" />
          </button>
        </div>

        {/* Right Column — Details & Actions */}
        <div className="flex flex-col px-4 md:px-0 space-y-6">
          <div>
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="inline-flex items-center rounded-md bg-terracotta/10 px-2 py-1 text-xs font-semibold text-terracotta capitalize">
                {product.categoria.replace("-", " ")}
              </span>
              {product.estado && (
                <span className="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs font-medium text-muted-foreground capitalize">
                  {product.estado}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-3 leading-snug">
              {product.titulo}
            </h1>
            
            <div className="mb-4">
              <PriceDisplay amount={Number(product.precio)} size="lg" className="text-3xl animate-slide-in-right" />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-charcoal/70 dark:text-neutral-400 font-medium">
              {product.ubicacion && (
                <span className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-800/50 px-2.5 py-1 rounded-lg">
                  <MapPin className="h-4 w-4 text-terracotta" />
                  {product.ubicacion}
                </span>
              )}
              <span className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-800/50 px-2.5 py-1 rounded-lg">
                <Truck className="h-4 w-4 text-terracotta" />
                {deliveryLabel}
              </span>
            </div>
          </div>

          <hr className="border-border/50" />

          {/* Seller Card mini */}
          <Link href={`/vendedor/${seller?.id}`} className="group block p-4 rounded-2xl bg-card border border-border/50 hover:border-terracotta/30 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 rounded-full bg-cream-dark dark:bg-neutral-800 flex items-center justify-center overflow-hidden border border-border/40 shadow-sm shrink-0">
                {seller?.foto ? (
                  <Image
                    src={seller.foto}
                    alt={seller.nombre ?? ""}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <span className="text-lg font-heading font-semibold text-terracotta">
                    {seller?.nombre?.charAt(0)?.toUpperCase() ?? "V"}
                  </span>
                )}
                {/* Verified badge overlap */}
                {seller?.trust_level !== "nuevo" && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-cream border-2 border-card flex items-center justify-center">
                    <ShieldCheck className="w-3 h-3 text-emerald-trust fill-cream" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-base group-hover:text-terracotta transition-colors truncate">
                    {seller?.nombre ?? "Vendedor Local"}
                  </span>
                  <SellerBadge level={(seller?.trust_level as TrustLevel) ?? "nuevo"} size="sm" />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <RatingStars
                    rating={Number(seller?.average_rating_as_seller ?? 0)}
                    count={Number(seller?.reviews_count_as_seller ?? 0)}
                    size="sm"
                  />
                  <span>·</span>
                  <span className="font-medium text-foreground">{seller?.total_sales ?? 0} ventas</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-terracotta group-hover:translate-x-1 transition-all" />
            </div>
          </Link>

          {/* Description */}
          <div className="space-y-3 p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/50 border border-border/30">
            <h3 className="font-heading font-semibold text-base">Descripción</h3>
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {product.descripcion}
            </p>
            {seller?.metodos_pago_aceptados && (
               <div className="pt-3 mt-3 border-t border-border/50 text-sm">
                 <span className="font-medium text-foreground">Pagos: </span>
                 <span className="text-muted-foreground">
                   {seller.metodos_pago_aceptados}
                 </span>
               </div>
            )}
          </div>

          {/* Coupons */}
          {coupons && coupons.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cupones aplicables</h3>
              <div className="flex flex-wrap gap-2">
                {coupons.map((c) => (
                  <div
                    key={c.codigo}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-trust/10 border border-emerald-trust/20 px-3 py-1.5 text-sm font-semibold text-emerald-trust"
                  >
                    <span className="text-base">🎁</span> {c.codigo}{" "}
                    <span className="opacity-80 font-medium">
                      {c.tipo_descuento === "porcentaje"
                        ? `(-${c.valor}%)`
                        : `(-$${c.valor})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons (Desktop) */}
          <div className="hidden md:flex gap-3 pt-2">
            <Link
              href={`/chat?seller=${seller?.id}&product=${product.id}`}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-terracotta px-6 py-4 text-base font-semibold text-white shadow-md hover:shadow-lg hover:bg-terracotta-dark hover:-translate-y-0.5 active:scale-95 transition-all duration-200"
            >
              <MessageCircle className="h-5 w-5 fill-white/20" />
              Contactar Vendedor
            </Link>
            <button className="flex items-center justify-center w-14 rounded-xl border border-border/60 bg-card hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-sm transition-colors active:scale-95">
              <Heart className="h-6 w-6 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Reviews Section */}
      {reviews && reviews.length > 0 && (
        <section className="mt-12 px-4 space-y-6 max-w-2xl mx-auto md:mx-0">
          <div className="flex items-center gap-2 mb-4 block">
            <h2 className="text-xl font-heading font-bold">
              Reseñas del producto
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-muted-foreground">
              {reviews.length}
            </span>
          </div>
          <div className="space-y-4">
            {reviews.map((review) => {
              const reviewer = Array.isArray(review.profiles)
                ? review.profiles[0]
                : review.profiles;
              return (
                <div key={review.id} className="p-5 rounded-2xl bg-card border border-border/40 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-cream-dark dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0 font-medium text-terracotta">
                      {reviewer?.nombre?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        {reviewer?.nombre ?? "Usuario Verificado"}
                      </div>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>
                  </div>
                  {review.comentario && (
                    <p className="text-sm text-muted-foreground leading-relaxed pl-13">
                      {review.comentario}
                    </p>
                  )}
                  {review.respuesta && (
                    <div className="ml-13 p-3 mt-3 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 text-sm">
                      <div className="flex items-center gap-1.5 mb-1 text-terracotta font-medium text-xs">
                        <MessageCircle className="w-3.5 h-3.5 fill-current" />
                        Respuesta del vendedor
                      </div>
                      <span className="text-muted-foreground leading-relaxed pl-5 block">
                        {review.respuesta}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky Mobile Nav Button */}
      <div className="md:hidden sticky bottom-[4.5rem] left-0 right-0 p-4 pb-2 z-30 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
        <Link
          href={`/chat?seller=${seller?.id}&product=${product.id}`}
          className="flex items-center justify-center gap-2 w-full rounded-2xl bg-terracotta px-4 py-4 text-sm font-semibold text-white shadow-lg pointer-events-auto active:scale-95 transition-transform"
        >
          <MessageCircle className="h-5 w-5 fill-white/20" />
          Contactar y Comprar
        </Link>
      </div>
    </div>
  );
}
