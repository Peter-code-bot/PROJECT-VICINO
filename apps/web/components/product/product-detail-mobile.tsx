"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/shared/price-display";
import { AppointmentButton } from "./appointment-button";
import { CouponBlock } from "./coupon-block";
import { DescriptionBlock } from "./description-block";
import { GalleryTopBar } from "./gallery-top-bar";
import { MetaRow } from "./meta-row";
import { PaymentChips } from "./payment-chips";
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

export function ProductDetailMobile({
  product,
  seller,
  reviews,
  coupons,
  user,
  isFavorite,
  isOwner,
  deliveryLabel,
}: ProductDetailMobileProps) {
  const searchParams = useSearchParams();
  const isVisitorPreview = searchParams.get("preview") === "visitor";
  // Owner that opted into preview should see the visitor-styled UI but the
  // real isOwner check is preserved for the StickyCta which derives both
  // variants from real ownership + the preview flag itself.
  const effectiveIsOwner = isOwner && !isVisitorPreview;

  const [reviewsOpen, setReviewsOpen] = useState(false);

  const images =
    product.galeria_imagenes && product.galeria_imagenes.length > 0
      ? product.galeria_imagenes
      : product.imagen_principal
        ? [product.imagen_principal]
        : [];

  const canShowAppointment =
    !!product.allow_appointments && !!user && !effectiveIsOwner;

  const averageRating = Number(seller.average_rating ?? 0);
  const reviewsCount = Number(seller.reviews_count ?? reviews.length);

  return (
    <div className="flex flex-col bg-bg pb-28">
      <div className="relative">
        <ProductGalleryCarousel
          images={images}
          title={product.titulo}
          savedSizes={product.gallery_sizes}
        />
        <GalleryTopBar
          productId={product.id}
          productTitle={product.titulo}
          isFavorite={isFavorite}
          isOwner={effectiveIsOwner}
        />
      </div>

      <div className="flex flex-col gap-5 px-4 py-5">
        <MetaRow
          categoria={product.categoria}
          ubicacion={product.ubicacion}
          sellerLat={seller.ubicacion_lat ?? null}
          sellerLng={seller.ubicacion_lng ?? null}
        />

        <h1 className="font-display text-[26px] font-semibold leading-tight text-fg">
          {product.titulo}
        </h1>

        <div>
          <PriceDisplay
            amount={Number(product.precio ?? 0)}
            size="lg"
            className="text-3xl"
          />
        </div>

        <SpecRow
          estado={product.estado}
          deliveryLabel={deliveryLabel}
          createdAt={product.created_at}
        />

        <SellerCardMini seller={seller} />

        <DescriptionBlock descripcion={product.descripcion} />

        <PaymentChips
          metodosPagoAceptados={seller.metodos_pago_aceptados ?? null}
        />

        <TrustCallout />

        <CouponBlock coupons={coupons} />

        {canShowAppointment ? (
          <AppointmentButton
            product={{
              id: product.id,
              titulo: product.titulo,
              creador_id: product.creador_id,
              appointment_start_time:
                product.appointment_start_time ?? "09:00",
              appointment_end_time: product.appointment_end_time ?? "18:00",
              appointment_duration_minutes:
                product.appointment_duration_minutes ?? 60,
            }}
          />
        ) : null}

        <ReviewsSummary
          reviews={reviews}
          averageRating={averageRating}
          reviewsCount={reviewsCount}
          onOpenReviews={() => setReviewsOpen(true)}
        />
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
