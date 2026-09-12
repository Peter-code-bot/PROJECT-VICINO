"use client";


import { useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/shared/price-display";
import { priceFallbackLabel } from "@/lib/price-mode";
import { AppointmentButton } from "./appointment-button";
import { ProductCoupons, ProductReviews } from "./product-extras";
import { DescriptionBlock } from "./description-block";
import { GalleryTopBar } from "./gallery-top-bar";
import { ListingStatusBanner } from "./listing-status-banner";
import { LocationBanner } from "./location-banner";
import { MetaRow } from "./meta-row";
import { NegociablePill } from "./negociable-pill";
import { PaymentChips } from "./payment-chips";
import { PreviewBanner } from "./preview-banner";
import { ProductGalleryCarousel } from "./product-gallery-carousel";
import { SellerCardMini } from "./seller-card-mini";
import { SpecRow } from "./spec-row";
import { StickyCta } from "./sticky-cta";
import { TrustCallout } from "./trust-callout";
import type { ProductDetailData } from "./types";

interface ProductDetailMobileProps extends ProductDetailData {
  className?: string;
}

export function ProductDetailMobile({
  product,
  seller,
  reviews,
  coupons,
  extras,
  user,
  isFavorite,
  isOwner,
  deliveryLabel,
  categoryName,
}: ProductDetailMobileProps) {
  const searchParams = useSearchParams();
  const isVisitorPreview = searchParams.get("preview") === "visitor";
  const effectiveIsOwner = isOwner && !isVisitorPreview;


  const images =
    product.galeria_imagenes && product.galeria_imagenes.length > 0
      ? product.galeria_imagenes
      : product.imagen_principal
        ? [product.imagen_principal]
        : [];


  const canShowAppointment =
    !!product.allow_appointments && !!user && !effectiveIsOwner;


  return (
    <div className="flex flex-col bg-bg pb-[calc(env(safe-area-inset-bottom)+8rem)]">
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
          estatus={product.estatus ?? ""}
        />
      </div>

      <div className="flex flex-col gap-5 px-4 py-5">
        <div>
          <MetaRow
            categoria={product.categoria}
            categoryName={categoryName}
            ubicacion={product.ubicacion}
            sellerLat={seller.ubicacion_lat ?? null}
            sellerLng={seller.ubicacion_lng ?? null}
          />
        </div>

        <div>
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-[26px] font-semibold leading-tight text-fg">
              {product.titulo}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <PriceDisplay
                amount={product.precio}
                fallback={priceFallbackLabel(product.modo_precio)}
                size="lg"
                className="text-3xl"
              />
            </div>
          </div>
        </div>

        <div>
          <SpecRow
            estado={product.estado}
            color={product.color}
            deliveryLabel={deliveryLabel}
            createdAt={product.created_at}
            tipo={product.tipo}
          />
        </div>

        <div>
          <SellerCardMini seller={seller} />
        </div>

        <div>
          <LocationBanner ubicacion={product.ubicacion} />
        </div>

        <div>
          <DescriptionBlock descripcion={product.descripcion} />
        </div>

        <div>
          <PaymentChips
            metodosPagoAceptados={seller.metodos_pago_aceptados ?? null}
          />
        </div>

        <div>
          <TrustCallout />
        </div>

        <div>
          <ProductCoupons extras={extras} coupons={coupons} />
        </div>

        {canShowAppointment ? (
          <div>
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
          </div>
        ) : null}

        <div>
          <ProductReviews key={product.id} extras={extras} reviews={reviews} seller={seller} currentUserId={user?.id ?? null} productId={product.id} />
        </div>
      </div>

      <StickyCta
        productId={product.id}
        sellerId={seller.id}
        isOwner={isOwner}
        hasSession={!!user}
      />

    </div>
  );
}
