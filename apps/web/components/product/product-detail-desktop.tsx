"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Edit3, Eye, MessageCircle, ShoppingBag } from "lucide-react";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { PriceDisplay } from "@/components/shared/price-display";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { AppointmentButton } from "./appointment-button";
import { CouponBlock } from "./coupon-block";
import { DescriptionBlock } from "./description-block";
import { ListingStatusBanner } from "./listing-status-banner";
import { MetaRow } from "./meta-row";
import { NegociablePill } from "./negociable-pill";
import { PaymentChips } from "./payment-chips";
import { PreviewBanner } from "./preview-banner";
import { ProductGallery } from "./product-gallery";
import { ProductReviewsTrigger } from "./product-reviews-trigger";
import { ReviewsSummary } from "./reviews-summary";
import { SellerCardMini } from "./seller-card-mini";
import { SpecRow } from "./spec-row";
import { TrustCallout } from "./trust-callout";
import type { DrawerReview } from "./product-reviews-drawer";
import type { ProductDetailData } from "./types";

interface ProductDetailDesktopProps extends ProductDetailData {
  className?: string;
}

const STAGGER_MS = 50;

function stagger(idx: number): CSSProperties {
  return { animationDelay: `${idx * STAGGER_MS}ms` };
}

function StaggerItem({ idx, children }: { idx: number; children: ReactNode }) {
  return (
    <div className="animate-fade-in-up" style={stagger(idx)}>
      {children}
    </div>
  );
}

export function ProductDetailDesktop({
  product,
  seller,
  reviews,
  coupons,
  user,
  isFavorite,
  isOwner,
  deliveryLabel,
}: ProductDetailDesktopProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isVisitorPreview = searchParams.get("preview") === "visitor";
  const effectiveIsOwner = isOwner && !isVisitorPreview;

  const [reviewsOpen, setReviewsOpen] = useState(false);

  const images =
    product.galeria_imagenes && product.galeria_imagenes.length > 0
      ? product.galeria_imagenes
      : product.imagen_principal
        ? [product.imagen_principal]
        : [];

  const safeCoupons = coupons ?? [];

  const canShowAppointment =
    !!product.allow_appointments && !!user && !effectiveIsOwner;

  const averageRating = Number(seller.average_rating ?? 0);
  const reviewsCount = Number(seller.reviews_count ?? reviews.length);

  const previewUrl = `${pathname}?preview=visitor`;
  const loginRedirect = `/login?redirect=${encodeURIComponent(pathname)}`;
  const buyHref = `/chat?seller=${seller.id}&product=${product.id}&intent=buy`;
  const contactHref = `/chat?seller=${seller.id}&product=${product.id}`;

  return (
    <div className="flex flex-col gap-10">
      <div className="sticky top-0 z-30 flex flex-col">
        <ListingStatusBanner isOwner={isOwner} estatus={product.estatus} />
        <PreviewBanner isOwner={isOwner} />
      </div>

      <div className="grid grid-cols-1 gap-10 px-4 md:px-0 lg:grid-cols-[1.1fr_1fr]">
        <div className="overflow-hidden rounded-[var(--r-lg)]">
          <ProductGallery
            images={images}
            title={product.titulo}
            isOwner={effectiveIsOwner}
            productId={product.id}
            savedSizes={product.gallery_sizes}
          />
        </div>

        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <StaggerItem idx={0}>
            <MetaRow
              categoria={product.categoria}
              ubicacion={product.ubicacion}
              sellerLat={seller.ubicacion_lat ?? null}
              sellerLng={seller.ubicacion_lng ?? null}
            />
          </StaggerItem>

          <StaggerItem idx={1}>
            <div className="flex items-start gap-2">
              <h1 className="flex-1 font-display text-3xl font-semibold leading-tight text-fg">
                {product.titulo}
              </h1>
              {user && !effectiveIsOwner ? (
                <ReportMenuButton
                  targetType="listing"
                  targetId={product.id}
                  targetLabel={product.titulo}
                  ariaLabel="Reportar este producto"
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriceDisplay
                amount={Number(product.precio ?? 0)}
                size="lg"
                className="text-4xl"
              />
              {product.precio_negociable && <NegociablePill />}
            </div>
          </StaggerItem>

          <StaggerItem idx={2}>
            <SpecRow
              estado={product.estado}
              deliveryLabel={deliveryLabel}
              createdAt={product.created_at}
              tipo={product.tipo}
            />
          </StaggerItem>

          <StaggerItem idx={3}>
            <SellerCardMini seller={seller} />
          </StaggerItem>

          <StaggerItem idx={4}>
            <DescriptionBlock descripcion={product.descripcion} />
          </StaggerItem>

          <StaggerItem idx={5}>
            <PaymentChips
              metodosPagoAceptados={seller.metodos_pago_aceptados ?? null}
            />
          </StaggerItem>

          <StaggerItem idx={6}>
            <TrustCallout />
          </StaggerItem>

          <StaggerItem idx={7}>
            <CouponBlock coupons={safeCoupons} />
          </StaggerItem>

          <StaggerItem idx={8}>
            <div className="flex flex-col gap-2 pt-2">
              {effectiveIsOwner ? (
                <>
                  <Link
                    href={previewUrl}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-card-2 px-4 py-4 text-base font-semibold text-fg shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-card"
                  >
                    <Eye className="h-5 w-5" />
                    Ver como visitante
                  </Link>
                  <Link
                    href={`/mis-productos/${product.id}/editar`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-4 text-base font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
                  >
                    <Edit3 className="h-5 w-5" />
                    Editar producto
                  </Link>
                </>
              ) : !user ? (
                <Link
                  href={loginRedirect}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-4 text-base font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
                >
                  <ShoppingBag className="h-5 w-5" />
                  Quiero comprarlo
                </Link>
              ) : (
                <>
                  <Link
                    href={buyHref}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-4 text-base font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
                  >
                    <ShoppingBag className="h-5 w-5" />
                    Quiero comprarlo
                  </Link>
                  {canShowAppointment ? (
                    <AppointmentButton
                      product={{
                        id: product.id,
                        titulo: product.titulo,
                        creador_id: product.creador_id,
                        appointment_start_time:
                          product.appointment_start_time ?? "09:00",
                        appointment_end_time:
                          product.appointment_end_time ?? "18:00",
                        appointment_duration_minutes:
                          product.appointment_duration_minutes ?? 60,
                      }}
                    />
                  ) : null}
                  <div className="flex gap-2">
                    <Link
                      href={contactHref}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-card-2 px-4 py-3 text-sm font-semibold text-brand-hi shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-colors hover:bg-brand-tint"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Contactar Vendedor
                    </Link>
                    <FavoriteButton
                      productId={product.id}
                      initialFavorite={isFavorite}
                      size="lg"
                      variant="standalone"
                      className="h-12 w-12 rounded-2xl bg-card-2 shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                    />
                  </div>
                </>
              )}
            </div>
          </StaggerItem>
        </div>
      </div>

      <div className="animate-fade-in-up px-4 md:px-0" style={stagger(9)}>
        <ReviewsSummary
          reviews={reviews}
          averageRating={averageRating}
          reviewsCount={reviewsCount}
          onOpenReviews={() => setReviewsOpen(true)}
        />
      </div>

      <ProductReviewsTrigger
        reviews={reviews as unknown as DrawerReview[]}
        averageRating={averageRating}
        reviewsCount={reviewsCount}
        sellerName={seller.nombre ?? "Vendedor"}
        sellerAvatar={seller.foto ?? null}
        currentUserId={user?.id ?? null}
        currentProductId={product.id}
        externalOpen={reviewsOpen}
        onExternalClose={() => setReviewsOpen(false)}
        side="right"
      />
    </div>
  );
}
