import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { ProductGallery } from "@/components/product/product-gallery";
import { AppointmentButton } from "@/components/product/appointment-button";
import { MessageCircle, ShoppingBag, MapPin, Truck, ShieldCheck, ChevronRight } from "lucide-react";
import type { TrustLevel } from "@vicino/shared";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { ProductReviewsTrigger } from "@/components/product/product-reviews-trigger";
import { ProductDetailMobile } from "@/components/product/product-detail-mobile";
import { ProductDetailDesktop } from "@/components/product/product-detail-desktop";
import type {
  ProductDetailCoupon,
  ProductDetailData,
  ProductDetailReview,
} from "@/components/product/types";

// Feature flag for the v2 redesign. While false, the legacy JSX below is
// rendered identically to production. Flipping to true switches to the
// new ProductDetailMobile and ProductDetailDesktop wrappers. See plan
// at .claude/plans/redise-o-p-gina-lazy-flame.md for the rollout.
const RENDER_V2 = true;

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
        average_rating, reviews_count, total_sales
      )
    `
    )
    .eq("slug", slug)
    // .neq() (NOT .eq("disponible")) on purpose — RLS already filters
    // non-creators to disponible-only via block_aware_products_select; the
    // creator-bypass path needs to keep working so a seller can preview their
    // own pausado/borrador/agotado listing detail before relisting it.
    .neq("estatus", "eliminado")
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
      id, rating, comentario, created_at, review_type, respuesta, respuesta_fecha, reviewer_id,
      profiles!reviewer_id(nombre, foto, trust_level),
      products_services!product_id(id, titulo, categoria, slug, imagen_principal)
    `
    )
    .eq("product_id", product.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(50);

  // Get active coupons for this seller
  const { data: coupons } = await supabase
    .from("coupons")
    .select("codigo, tipo_descuento, valor")
    .eq("vendedor_id", product.creador_id)
    .eq("activo", true)
    .or("fecha_expiracion.is.null,fecha_expiracion.gt." + new Date().toISOString())
    .limit(5);

  // Check if user has favorited this product
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isFavorite = false;
  if (user) {
    const { data: fav } = await supabase
      .from("favorites")
      .select("id")
      .eq("usuario_id", user.id)
      .eq("producto_id", product.id)
      .maybeSingle();
    isFavorite = !!fav;
  }

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

  const isOwner = user?.id === product.creador_id;

  // Hydrated payload for the v2 wrappers. With RENDER_V2 = false the
  // wrappers are imported but not executed at runtime, so the page
  // continues to render the legacy JSX below identically. The cast is
  // intentional while the wrappers are stubs; Fase 2+ will refine.
  const data: ProductDetailData = {
    product: product as unknown as ProductDetailData["product"],
    seller: seller as unknown as ProductDetailData["seller"],
    reviews: (reviews ?? []) as ProductDetailReview[],
    coupons: (coupons ?? []) as ProductDetailCoupon[],
    isFavorite,
    user: user ? { id: user.id } : null,
    isOwner,
    deliveryLabel,
  };

  return (
    <div className="max-w-4xl mx-auto md:py-8 animate-fade-in">
      {/* Breadcrumbs (Desktop only) */}
      <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground mb-6 px-4">
        <Link href="/" className="hover:text-primary transition-colors">Inicio</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href={`/buscar?category=${product.categoria}`} className="hover:text-primary transition-colors capitalize">
          {product.categoria.replace("-", " ")}
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground truncate max-wxs">{product.titulo}</span>
      </div>

      {RENDER_V2 ? (
        <>
          <div className="md:hidden">
            <ProductDetailMobile {...data} />
          </div>
          <div className="hidden md:block">
            <ProductDetailDesktop {...data} />
          </div>
        </>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:px-4">
        {/* Left Column — Gallery */}
        <div className="relative">
          <ProductGallery
            images={
              product.galeria_imagenes?.length
                ? product.galeria_imagenes
                : product.imagen_principal
                  ? [product.imagen_principal]
                  : []
            }
            title={product.titulo}
            isOwner={user?.id === product.creador_id}
            productId={product.id}
            savedSizes={product.gallery_sizes ?? null}
          />
          {/* Mobile Fav Button */}
          <div className="md:hidden absolute top-4 right-4 z-10">
            <FavoriteButton productId={product.id} initialFavorite={isFavorite} size="md" className="shadow-lg" />
          </div>
        </div>

        {/* Right Column — Details & Actions */}
        <div className="flex flex-col px-4 md:px-0 space-y-6">
          <div>
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="inline-flex items-center rounded-md bg-[color:var(--brand-tint-strong)] px-2 py-1 text-xs font-semibold text-[color:var(--brand-hi)] capitalize shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
                {product.categoria.replace("-", " ")}
              </span>
              {product.estado && (
                <span className="inline-flex items-center rounded-md bg-[color:var(--card-2)] px-2 py-1 text-xs font-medium text-[color:var(--fg-muted)] capitalize shadow-[inset_0_0_0_1px_var(--border)]">
                  {product.estado}
                </span>
              )}
            </div>

            <div className="flex items-start gap-2 mb-3">
              <h1 className="flex-1 text-2xl sm:text-3xl font-heading font-bold leading-snug">
                {product.titulo}
              </h1>
              {user && user.id !== product.creador_id && (
                <ReportMenuButton
                  targetType="listing"
                  targetId={product.id}
                  targetLabel={product.titulo}
                  ariaLabel="Reportar este producto"
                  className="mt-1"
                />
              )}
            </div>
            
            <div className="mb-4">
              <PriceDisplay amount={Number(product.precio)} size="lg" className="text-3xl animate-slide-in-right" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {product.ubicacion && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--card-2)] px-2.5 py-1 text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
                  <MapPin className="h-4 w-4 text-[color:var(--brand-hi)]" />
                  {product.ubicacion}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--card-2)] px-2.5 py-1 text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
                <Truck className="h-4 w-4 text-[color:var(--brand-hi)]" />
                {deliveryLabel}
              </span>
            </div>
          </div>

          <hr className="border-border/50" />

          {/* Seller Card mini */}
          <Link href={`/vendedor/${seller?.id}`} className="group block rounded-2xl bg-[color:var(--card)] p-4 shadow-[inset_0_0_0_1px_var(--border)] transition-all duration-300 hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong),var(--shadow-glow)]">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 rounded-full bg-card dark:bg-neutral-800 flex items-center justify-center overflow-hidden border border-border/40 shadow-sm shrink-0">
                {seller?.foto ? (
                  <Image
                    src={seller.foto}
                    alt={seller.nombre ?? ""}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <span className="text-lg font-heading font-semibold text-primary">
                    {seller?.nombre?.charAt(0)?.toUpperCase() ?? "V"}
                  </span>
                )}
                {/* Verified badge overlap */}
                {seller?.trust_level !== "nuevo" && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-card border-2 border-background flex items-center justify-center">
                    <ShieldCheck className="w-3 h-3 text-emerald-trust" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-base group-hover:text-primary transition-colors truncate">
                    {seller?.nombre ?? "Vendedor Local"}
                  </span>
                  <SellerBadge level={(seller?.trust_level as TrustLevel) ?? "nuevo"} size="sm" />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <RatingStars
                    rating={Number(seller?.average_rating ?? 0)}
                    count={Number(seller?.reviews_count ?? 0)}
                    size="sm"
                  />
                  <span>·</span>
                  <span className="font-medium text-foreground">{seller?.total_sales ?? 0} ventas</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
          </Link>

          {/* Description */}
          <div className="space-y-3 rounded-2xl bg-[color:var(--card)] p-5 shadow-[inset_0_0_0_1px_var(--border)]">
            <h3 className="font-heading text-base font-semibold text-[color:var(--fg)]">Descripción</h3>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--fg-muted)]">
              {product.descripcion}
            </p>
            {seller?.metodos_pago_aceptados && (
              <div className="mt-3 border-t border-[color:var(--border)] pt-3 text-sm">
                <span className="font-medium text-[color:var(--fg)]">Pagos: </span>
                <span className="text-[color:var(--fg-muted)]">
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
          <div className="hidden md:flex flex-col gap-2 pt-2">
            {user && user.id !== product.creador_id && (
              <Link
                href={`/chat?seller=${seller?.id}&product=${product.id}&intent=buy`}
                className="flex items-center justify-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-4 text-base font-semibold text-white shadow-[var(--shadow-glow)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[color:var(--brand-dark)] active:scale-95"
              >
                <ShoppingBag className="h-5 w-5" />
                Quiero comprarlo
              </Link>
            )}
            {product.allow_appointments && user && user.id !== product.creador_id && (
              <AppointmentButton
                product={{
                  id: product.id,
                  titulo: product.titulo,
                  creador_id: product.creador_id,
                  appointment_start_time: product.appointment_start_time ?? "09:00",
                  appointment_end_time: product.appointment_end_time ?? "18:00",
                  appointment_duration_minutes: product.appointment_duration_minutes ?? 60,
                }}
              />
            )}
            <div className="flex gap-3">
              <Link
                href={`/chat?seller=${seller?.id}&product=${product.id}`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--card-2)] px-6 py-3 text-sm font-semibold text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-all duration-200 hover:bg-[color:var(--brand-tint)] active:scale-95"
              >
                <MessageCircle className="h-4 w-4" />
                Contactar Vendedor
              </Link>
              <FavoriteButton productId={product.id} initialFavorite={isFavorite} size="lg" variant="standalone" className="h-14 w-14 rounded-xl bg-[color:var(--card-2)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]" />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Reviews Section (legacy, replaced by ReviewsSummary in v2) */}
      {!RENDER_V2 && reviews && reviews.length > 0 && (
        <section className="mt-12 px-4 space-y-6 max-w-2xl mx-auto md:mx-0">
          <div className="flex items-center gap-2 mb-4 block">
            <h2 className="text-xl font-heading font-bold">
              Reseñas del producto
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {reviews.length}
            </span>
          </div>
          <div className="space-y-4">
            {reviews.map((review) => {
              const reviewer = Array.isArray(review.profiles)
                ? review.profiles[0]
                : review.profiles;
              const reviewedProduct = Array.isArray(review.products_services)
                ? review.products_services[0]
                : review.products_services;
              const isOwnReview = user?.id === review.reviewer_id;
              return (
                <div key={review.id} className="space-y-3 rounded-2xl bg-[color:var(--card)] p-5 shadow-[inset_0_0_0_1px_var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-card dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0 font-medium text-primary">
                      {reviewer?.nombre?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">
                        {reviewer?.nombre ?? "Usuario Verificado"}
                      </div>
                      <RatingStars rating={review.rating} size="sm" />
                    </div>
                    {user && !isOwnReview && (
                      <ReportMenuButton
                        targetType="review"
                        targetId={review.id}
                        targetLabel={review.comentario ? review.comentario.slice(0, 60) : `Reseña de ${reviewer?.nombre ?? "usuario"}`}
                        iconSize={14}
                        ariaLabel="Reportar reseña"
                      />
                    )}
                  </div>
                  {review.comentario && (
                    <p className="text-sm text-muted-foreground leading-relaxed pl-13">
                      {review.comentario}
                    </p>
                  )}
                  {review.respuesta && (
                    <div className="ml-13 p-3 mt-3 rounded-lg bg-muted/50 text-sm">
                      <div className="flex items-center gap-1.5 mb-1 text-primary font-medium text-xs">
                        <MessageCircle className="w-3.5 h-3.5 fill-current" />
                        Respuesta del vendedor
                      </div>
                      <span className="text-muted-foreground leading-relaxed pl-5 block">
                        {review.respuesta}
                      </span>
                    </div>
                  )}
                  {reviewedProduct?.id !== product.id && (
                    <div className="pt-2 border-t border-border/30">
                      <ReviewProductLink product={reviewedProduct ?? null} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky Mobile Nav Button (legacy, replaced by StickyCta in v2) */}
      {!RENDER_V2 && (
        <div className="pointer-events-none sticky bottom-[4.5rem] left-0 right-0 z-30 bg-gradient-to-t from-[color:var(--bg)] via-[color:var(--bg)]/95 to-transparent p-4 pb-2 md:hidden">
          <Link
            href={`/chat?seller=${seller?.id}&product=${product.id}&intent=buy`}
            className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] px-4 py-4 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
          >
            <ShoppingBag className="h-5 w-5" />
            Quiero comprarlo
          </Link>
        </div>
      )}

      {/* Reviews drawer trigger (legacy uncontrolled, replaced by lifted state in v2) */}
      {!RENDER_V2 && (
        <ProductReviewsTrigger
          reviews={reviews ?? []}
          averageRating={Number(seller?.average_rating ?? 0)}
          reviewsCount={Number(seller?.reviews_count ?? 0)}
          sellerName={seller?.nombre ?? "Vendedor"}
          sellerAvatar={seller?.foto ?? null}
          currentUserId={user?.id ?? null}
          currentProductId={product.id}
        />
      )}
    </div>
  );
}
