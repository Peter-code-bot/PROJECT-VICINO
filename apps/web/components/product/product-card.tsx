"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SellerBadge } from "@/components/shared/seller-badge";
import { RatingStars } from "@/components/shared/rating-stars";
import { PriceDisplay } from "@/components/shared/price-display";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { NegociablePill } from "@/components/product/negociable-pill";
import { CategoryBadge } from "@/components/product/category-badge";
import type { ProductCardCategory, TrustLevel } from "@vicino/shared";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  id: string;
  titulo: string;
  precio: number;
  imagen: string | null;
  categoria: string;
  slug: string;
  vendedor: {
    nombre: string;
    trust_level: TrustLevel;
  };
  rating: number;
  reviewsCount: number;
  isFavorite?: boolean;
  precioNegociable?: boolean;
  // MP#08 #5c-4: array opcional normalizado primary-first via
  // normalizeCardCategories(product.product_categories) en el caller.
  // Default [] mantiene la card identica para callers no migrados.
  categories?: ProductCardCategory[];
  // A3 sub-fase 3.3: solo true para la PRIMERA card de una grid/carousel
  // above-fold (LCP candidate). Default false manda lazy load.
  priority?: boolean;
}

export function ProductCard({
  id,
  titulo,
  precio,
  imagen,
  categoria,
  slug,
  vendedor,
  rating,
  reviewsCount,
  isFavorite: initialFavorite = false,
  precioNegociable,
  categories = [],
  priority = false,
}: ProductCardProps) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);

  // A5.3: just-in-time view-transition-name. Applied imperatively on the
  // image wrapper at the moment of click so only the CLICKED card
  // participates in the transition. This is important because the same
  // product can appear in two carousels on the home (Recientes AND its
  // per-category carousel). If the name were declared statically on
  // every card, two cards on the same page would share the same
  // view-transition-name during the snapshot and the browser would
  // either pick an arbitrary one or skip the transition entirely.
  // Setting the style via the ref keeps the DOM clean until the click
  // moment, then guarantees uniqueness for the navigation that follows.
  //
  // CODEX M3 fix: clear the name AFTER the transition has captured the
  // snapshot. Without the cleanup, an interrupted transition (browser
  // without support, immediate back navigation, modal that catches the
  // click) leaves the name on the card permanently -- a future unrelated
  // transition could see the orphan name and behave inconsistently. The
  // 500ms delay is generous: the browser captures the snapshot
  // synchronously inside startViewTransition (called by Next's wrapper),
  // so by the time this fires the property has already been read.
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  function handleNavigate() {
    const el = imageWrapperRef.current;
    if (!el) return;
    el.style.viewTransitionName = `product-hero-${id}`;
    // F12 (reverse navigation): persist which card was tapped so the
    // home re-mount after detail->back can re-apply the same transition
    // name to the matching card. sessionStorage scope is the tab, which
    // matches the back-button user mental model. Consumed + cleared in
    // the mount effect below; the cleanup there guarantees we never
    // leak stale state into an unrelated future navigation.
    try {
      sessionStorage.setItem("vicino:return-product", id);
    } catch {
      // Storage quota / private mode — degrade silently to forward-only
      // transition (which is the pre-F12 behavior).
    }
    setTimeout(() => {
      // Re-check the ref because the component may unmount during the
      // navigation that this click triggers.
      const stillThere = imageWrapperRef.current;
      if (stillThere) stillThere.style.viewTransitionName = "";
    }, 500);
  }

  // F12 (reverse navigation): on mount, if sessionStorage holds this
  // card's id (meaning the user just navigated detail->home via back),
  // re-apply the view-transition-name so the browser pairs the home
  // card image with the exiting detail hero for the reverse animation.
  // CONSUME + CLEAR on first match -- if the home renders the same id
  // in two carousels (Recientes + per-category), the first mount wins
  // and the second sees an empty storage. Only one card participates,
  // matching the forward navigation's just-in-time uniqueness rule.
  // The 500 ms cleanup mirrors the forward path: by then the browser
  // has captured the snapshot and the property is free to clear.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem("vicino:return-product");
    } catch {
      // No storage available — nothing to consume.
      return;
    }
    if (stored !== id) return;
    try {
      sessionStorage.removeItem("vicino:return-product");
    } catch {
      // ignore
    }
    const el = imageWrapperRef.current;
    if (!el) return;
    el.style.viewTransitionName = `product-hero-${id}`;
    const t = setTimeout(() => {
      const stillThere = imageWrapperRef.current;
      if (stillThere) stillThere.style.viewTransitionName = "";
    }, 500);
    return () => clearTimeout(t);
  }, [id]);

  const { mutate: toggleFav, isPending } = useOptimisticMutation(
    toggleFavorite,
    {
      onMutate: () => {
        const previous = isFavorite;
        setIsFavorite(!previous);
        return () => setIsFavorite(previous);
      },
      onSuccess: (result) => {
        if (
          result &&
          typeof result === "object" &&
          "isFavorite" in result &&
          typeof result.isFavorite === "boolean"
        ) {
          setIsFavorite(result.isFavorite);
        }
      },
    },
  );

  return (
    <Link
      // MP#08 #4 Fase 1B: href deriva el segmento de categoria de la primary
      // del pivote (categories ya viene normalized primary-first desde el
      // caller post-5c-4). Fallback al prop categoria TEXT si categories
      // esta vacio (caller no migrado o edge sin pivote). Cuando 1C dropee
      href={`/${categories[0]?.slug ?? categoria}/${slug}`}
      id={`product-${slug}`}
      prefetch={false}
      onClick={handleNavigate}
      className={cn(
        "group relative block w-full min-w-0 overflow-hidden rounded-2xl product-card-custom transition-all duration-300",
        "hover:-translate-y-0.5"
      )}
    >
      <div ref={imageWrapperRef} className="relative aspect-square overflow-hidden bg-bg-elev-2">
        {imagen ? (
          <Image
            src={imagen}
            alt={titulo}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <span className="mb-1 block text-3xl">📷</span>
              <span className="text-xs text-fg-dim">Sin imagen</span>
            </div>
          </div>
        )}

        {/* Price chip — refinada variant, top-right */}
        <div className="pointer-events-none absolute top-2 right-2">
          <div
            className={cn(
              "inline-flex items-center rounded-md px-2 py-1",
              "bg-white/92 text-brand-dark",
              "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
            )}
          >
            <PriceDisplay
              amount={precio}
              size="sm"
              className="font-heading font-bold text-brand-dark"
            />
          </div>
        </div>

        {/* Negociable badge — corner ribbon */}
        {precioNegociable && <NegociablePill />}

        {/* Favorite — bottom-right floating */}
        <button
          type="button"
          disabled={isPending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void toggleFav(id);
          }}
          aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
          className={cn(
            "absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
            "backdrop-blur-md hover:scale-110 active:scale-95",
            isFavorite
              ? "bg-danger text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]"
              : "bg-black/40 text-white hover:bg-black/55"
          )}
        >
          <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="relative pt-7 px-3.5 pb-3 product-card-text">
        {/* Tab de categoría flotante */}
        {categories.length > 0 && categories[0] && (
          <div className="absolute top-0 left-3.5 -translate-y-1/2 flex items-center gap-1">
             <span className="inline-flex px-2.5 py-1 rounded product-card-tab font-heading font-extrabold text-[9.5px] tracking-[1.4px] uppercase shadow-[0_4px_10px_rgba(0,0,0,0.30)]">
               {categories[0].nombre}
             </span>
             {categories.length > 1 && (
               <span className="text-[10px] font-semibold product-card-muted">
                 +{categories.length - 1}
               </span>
             )}
          </div>
        )}

        {/* Título */}
        <div className="h-[2.6em] overflow-hidden">
          <h3 className="line-clamp-2 font-heading font-bold text-[14.5px] leading-[1.3] tracking-[-0.3px] product-card-text">
            {titulo}
          </h3>
        </div>

        {/* Seller row */}
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium product-card-semi">
          <span className="truncate">
            {vendedor.nombre}
          </span>
          <SellerBadge level={vendedor.trust_level} showLabel={false} size="sm" />
        </div>

        {/* Rating */}
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex">
            {[0, 1, 2, 3, 4].map((i) => (
              <svg key={i} width="10" height="10" viewBox="0 0 24 24"
                   className={i < Math.floor(rating || 0) ? 'fill-[#D4A853]' : 'product-card-rating-empty'}>
                <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7l3-7z"/>
              </svg>
            ))}
          </div>
          {rating > 0 ? (
            <div className="flex gap-1 items-center">
               <span className="text-[10.5px] font-semibold product-card-text">{rating}</span>
               <span className="text-[10.5px] product-card-muted">({reviewsCount})</span>
            </div>
          ) : (
            <span className="text-[10.5px] product-card-muted">Sin reseñas</span>
          )}
        </div>
      </div>
    </Link>
  );
}
