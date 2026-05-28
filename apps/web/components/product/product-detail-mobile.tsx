"use client";

import { PriceDisplay } from "@/components/shared/price-display";
import { CouponBlock } from "./coupon-block";
import { DescriptionBlock } from "./description-block";
import { GalleryTopBar } from "./gallery-top-bar";
import { MetaRow } from "./meta-row";
import { PaymentChips } from "./payment-chips";
import { ProductGalleryCarousel } from "./product-gallery-carousel";
import { SellerCardMini } from "./seller-card-mini";
import { SpecRow } from "./spec-row";
import { TrustCallout } from "./trust-callout";
import type { ProductDetailData } from "./types";

interface ProductDetailMobileProps extends ProductDetailData {
  className?: string;
}

export function ProductDetailMobile({
  product,
  seller,
  coupons,
  isFavorite,
  isOwner,
  deliveryLabel,
}: ProductDetailMobileProps) {
  const images =
    product.galeria_imagenes && product.galeria_imagenes.length > 0
      ? product.galeria_imagenes
      : product.imagen_principal
        ? [product.imagen_principal]
        : [];

  return (
    <div className="flex flex-col bg-bg">
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
          isOwner={isOwner}
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
      </div>
    </div>
  );
}
