import Image from "next/image";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { TrustLevel } from "@vicino/shared";
import { RatingStars } from "@/components/shared/rating-stars";
import { SellerBadge } from "@/components/shared/seller-badge";
import { cn } from "@/lib/utils";
import type { ProductDetailSeller } from "./types";

interface SellerCardMiniProps {
  seller: ProductDetailSeller;
  className?: string;
}

export function SellerCardMini({ seller, className }: SellerCardMiniProps) {
  const initials = seller.nombre?.charAt(0)?.toUpperCase() ?? "V";
  const trustLevel = (seller.trust_level as TrustLevel | null) ?? "nuevo";
  const showVerifiedBadge = Boolean(seller.is_verified);
  const showTrustBadge = trustLevel !== "nuevo";
  const totalSales = Number(seller.total_sales ?? 0);

  return (
    <Link
      href={`/vendedor/${seller.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--r-lg)] bg-card p-3 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-card-2",
        className,
      )}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-card-2">
        {seller.foto ? (
          <Image
            src={seller.foto}
            alt={seller.nombre ?? "Vendedor"}
            fill
            sizes="44px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-base font-semibold text-fg-muted">
            {initials}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">
            {seller.nombre ?? "Vendedor Local"}
          </span>
          {showVerifiedBadge ? (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-trust"
              aria-label="Vendedor verificado"
            />
          ) : showTrustBadge ? (
            <SellerBadge level={trustLevel} size="sm" />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
          <RatingStars
            rating={Number(seller.average_rating ?? 0)}
            count={Number(seller.reviews_count ?? 0)}
            size="sm"
          />
          <span aria-hidden className="text-fg-dim">·</span>
          <span>
            {totalSales} {totalSales === 1 ? "venta" : "ventas"}
          </span>
        </div>
      </div>

      <span className="ml-auto inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-brand-hi shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-colors group-hover:bg-brand-tint">
        Ver tienda
      </span>
    </Link>
  );
}
