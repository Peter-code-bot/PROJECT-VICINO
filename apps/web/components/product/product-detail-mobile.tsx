"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/shared/price-display";
import { AppointmentButton } from "./appointment-button";
import { CouponBlock } from "./coupon-block";
import { DescriptionBlock } from "./description-block";
import { GalleryTopBar } from "./gallery-top-bar";
import { ListingStatusBanner } from "./listing-status-banner";
import { MetaRow } from "./meta-row";
import { NegociablePill } from "./negociable-pill";
import { PaymentChips } from "./payment-chips";
import { PreviewBanner } from "./preview-banner";
import { ProductGalleryCarousel } from "./product-gallery-carousel";
import { ProductReviewsTrigger } from "./product-reviews-trigger";
import { ReviewsSummary } from "./reviews-summary";
import { SellerCardMini } from "./seller-card-mini";
import { SpecRow } from "./spec-row";
import { StickyCta } from "./sticky-cta";
import { TrustCallout } from "./trust-callout";
import type { DrawerReview } from "./product-reviews-drawer";
import type { ProductDetailData } from "./types";

interface ProductDetailMobileProps extends ProductDetailData {
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

export function ProductDetailMobile({
  product,
  seller,
  reviews,
  coupons,
  user,
  isFavorite,
  isOwner,
  deliveryLabel,
  categoryName,
}: ProductDetailMobileProps) {
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

  return (
    <div className="flex flex-col bg-bg pb-[calc(var(--bottom-nav-h)+5rem)]">
      <div className="sticky top-0 z-30 flex flex-col">
        <ListingStatusBanner isOwner={isOwner} estatus={product.estatus} />
        <PreviewBanner isOwner={isOwner} />
      </div>

      <div className="relative">
        <ProductGalleryCarousel
          images={images}
          title={product.titulo}
          savedSizes={product.gallery_sizes}
          productId={product.id}
        />
        {product.precio_negociable && <NegociablePill />}
        <GalleryTopBar
          productId={product.id}
          productTitle={product.titulo}
          isFavorite={isFavorite}
          isOwner={effectiveIsOwner}
        />
      </div>

      <div className="flex flex-col gap-5 px-4 py-5">
        <StaggerItem idx={0}>
          <MetaRow
            categoria={product.categoria}
            categoryName={categoryName}
            ubicacion={product.ubicacion}
            sellerLat={seller.ubicacion_lat ?? null}
            sellerLng={seller.ubicacion_lng ?? null}
          />
        </StaggerItem>

        <StaggerItem idx={1}>
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-[26px] font-semibold leading-tight text-fg">
              {product.titulo}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <PriceDisplay
                amount={Number(product.precio ?? 0)}
                size="lg"
                className="text-3xl"
              />
            </div>
          </div>
        </StaggerItem>

        <StaggerItem idx={2}>
          <SpecRow
            estado={product.estado}
            color={product.color}
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

        {canShowAppointment ? (
          <StaggerItem idx={8}>
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
          </StaggerItem>
        ) : null}

        <StaggerItem idx={canShowAppointment ? 9 : 8}>
          <ReviewsSummary
            reviews={reviews}
            averageRating={averageRating}
            reviewsCount={reviewsCount}
            onOpenReviews={() => setReviewsOpen(true)}
          />
        </StaggerItem>
      </div>

      <StickyCta
        productId={product.id}
        sellerId={seller.id}
        isOwner={isOwner}
        hasSession={!!user}
      />

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
      />
    </div>
  );
}
