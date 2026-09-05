import Link from "next/link";
import Image from "next/image";
import { MoreHorizontal, Heart, MessageCircle, MapPin, Tag, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@vicino/shared";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { PriceDisplay } from "@/components/shared/price-display";
import { priceFallbackLabel } from "@/lib/price-mode";

export interface StorePostProps {
  id: string;
  /**
   * Ruta del detalle, ya construida. `null` cuando la publicacion no tiene
   * slug: sin slug NO HAY pagina de detalle, porque esa ruta resuelve solo
   * por slug. En ese caso la tarjeta se pinta sin envolver, en vez de
   * ofrecer un boton que lleva a un 404.
   *
   * Se recibe hecha y no se calcula aqui: los datos que hacen falta —la
   * categoria primaria del pivote y el slug— viven en la consulta, no en las
   * props que este componente pinta.
   */
  href: string | null;
  storeId: string;
  store: string;
  letter: string;
  tier: TrustLevel;
  cat: string;
  when: string;
  flag?: {
    label: string;
    icon?: string;
    tone?: "gold" | "brand";
  };
  title: string;
  price: number | string | null;
  modoPrecio?: string | null;
  distance: string;
  rating: number;
  count: number;
  imgUrl?: string;
  imgLabel: string;
  heart?: boolean;
  // A3 sub-fase 3.3: solo true para el PRIMER StorePost del feed siguiendo
  // (LCP candidate). Default false manda lazy load.
  priority?: boolean;
}

/**
 * Envuelve en enlace SOLO si hay a donde ir.
 *
 * Sin esto habria que repetir el mismo ternario en los tres sitios donde la
 * tarjeta enlaza al detalle, y basta con olvidarlo en uno para volver a
 * ofrecer un enlace roto.
 */
function ConEnlace({
  href,
  className,
  children,
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function StorePost({
  id,
  href,
  storeId,
  store,
  letter,
  tier,
  cat,
  when,
  flag,
  title,
  price,
  modoPrecio,
  distance,
  rating,
  count,
  imgUrl,
  imgLabel,
  heart = false,
  priority = false,
}: StorePostProps) {
  return (
    <article className="flex flex-col mb-4 product-card-custom sm:rounded-2xl overflow-hidden">
      {/* 1. Header de tienda */}
      <header className="flex items-center px-4 py-3 gap-3">
        {/* El prefetch vuelve a estar activo en los cinco Links de la tarjeta.
            Se habia apagado para no lanzar 5 GETs por card, pero el remedio
            salio caro: sin prefetch cada toque paga la navegacion entera en
            frio. Ahora que /vendedor/[id] y la ficha tienen su loading.tsx, lo
            que se adelanta es el esqueleto, no la pagina renderizada. */}
        <Link href={`/vendedor/${storeId}`} className="shrink-0">
          <div className="w-10 h-10 rounded-[12px] bg-[var(--brand-tint)] flex items-center justify-center font-bold text-[var(--brand-hi)] text-lg">
            {letter}
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/vendedor/${storeId}`}
              className="font-medium product-card-text truncate hover:underline"
            >
              {store}
            </Link>
            <SellerBadge level={tier} showLabel={false} size="sm" />
          </div>
          <div className="text-[13px] product-card-muted flex items-center gap-1.5">
            <span className="truncate">{cat}</span>
            <span>·</span>
            <span>{when}</span>
          </div>
        </div>
        <button className="product-card-muted p-2 -mr-2" aria-label="Más opciones">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </header>

      {/* 2. Flag opcional */}
      {flag && (
        <div className="px-4 mb-2">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase",
              flag.tone === "gold"
                ? "bg-[rgba(212,168,83,0.18)] text-[color:var(--gold)]"
                : "bg-[var(--brand-tint-strong)] text-[var(--brand-hi)]"
            )}
          >
            {flag.icon === "tag" && <Tag className="w-3 h-3 mr-1" />}
            {flag.label}
          </span>
        </div>
      )}

      {/* 3. Imagen del producto */}
      <ConEnlace
        href={href}
        className="block relative aspect-square bg-[var(--bg-elev-2)] overflow-hidden"
      >
        {imgUrl ? (
          <Image
            src={imgUrl}
            alt={title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 512px"
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--fg-muted)] text-sm font-medium">
            {imgLabel}
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center bg-black/60 backdrop-blur-md text-white text-[12px] font-medium px-2.5 py-1 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
          <MapPin className="w-3.5 h-3.5 mr-1" />
          {distance}
        </div>
        <div className="absolute top-3 right-3">
          <FavoriteButton productId={id} initialFavorite={heart} size="md" variant="overlay" />
        </div>
        <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md text-white px-3 py-1.5 rounded-[12px] font-bold text-[15px] tracking-tight shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
          <PriceDisplay amount={price} fallback={priceFallbackLabel(modoPrecio)} className="text-white" />
        </div>
      </ConEnlace>

      {/* 4. Body */}
      <div className="px-4 pt-3 pb-2">
        <ConEnlace href={href} className="block">
          <h3 className="font-display text-[15.5px] leading-snug font-medium product-card-text mb-1.5 line-clamp-2">
            {title}
          </h3>
        </ConEnlace>
        {rating > 0 && count > 0 && (
          <RatingStars rating={rating} count={count} size="sm" />
        )}
      </div>

      {/* 5. Footer de acciones */}
      <footer className="flex items-center justify-between px-4 pb-4 pt-1">
        <div className="flex gap-2">
          <button className="flex items-center justify-center h-9 px-3 rounded-full text-[13px] font-medium product-card-muted hover:opacity-80 transition-colors">
            <Heart className="w-4 h-4 mr-1.5" />
            Guardar
          </button>
          <Link
            href={`/chat/nuevo?product=${id}`}
            className="flex items-center justify-center h-9 px-3 rounded-full text-[13px] font-medium product-card-muted hover:opacity-80 transition-colors"
          >
            <MessageCircle className="w-4 h-4 mr-1.5" />
            Mensaje
          </Link>
        </div>
        {href && (
          <Link
            href={href}
            className="flex items-center justify-center h-9 px-4 rounded-full product-card-btn text-[13.5px] font-medium hover:opacity-90 transition-colors"
          >
            Ver producto
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        )}
      </footer>
    </article>
  );
}
