"use client";

import { Ticket } from "lucide-react";
import { useState } from "react";
import { BottomSheet } from "./bottom-sheet";
import type { ProductDetailCoupon } from "./types";

interface CouponBlockProps {
  coupons: ProductDetailCoupon[];
}

function formatDiscount(coupon: ProductDetailCoupon): string {
  if (coupon.tipo_descuento === "porcentaje") {
    return `-${coupon.valor}%`;
  }
  return `-$${coupon.valor}`;
}

export function CouponBlock({ coupons }: CouponBlockProps) {
  const [open, setOpen] = useState(false);
  if (!coupons || coupons.length === 0) return null;

  const first = coupons[0];
  if (!first) return null;

  const extra = coupons.length - 1;

  return (
    <>
      <section className="flex flex-col gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
          Cupones disponibles
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex w-full items-center gap-2 rounded-[var(--r-lg)] border border-emerald-trust/20 bg-emerald-trust/10 px-3 py-2 text-left text-sm font-semibold text-emerald-trust transition-colors hover:bg-emerald-trust/15"
        >
          <Ticket className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{first.codigo}</span>
          <span className="ml-1 text-xs font-medium opacity-80">
            {formatDiscount(first)}
          </span>
          {extra > 0 ? (
            <span className="ml-auto rounded-full bg-emerald-trust/15 px-2 py-0.5 text-[11px] font-semibold">
              +{extra} más
            </span>
          ) : (
            <span className="ml-auto text-[11px] font-medium opacity-70">
              Ver detalle
            </span>
          )}
        </button>
      </section>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cupones disponibles"
        side="bottom"
        zIndex={51}
      >
        <ul className="flex flex-col gap-2">
          {coupons.map((coupon) => (
            <li
              key={coupon.codigo}
              className="flex items-center gap-3 rounded-[var(--r-lg)] border border-emerald-trust/20 bg-emerald-trust/10 p-3"
            >
              <Ticket className="h-5 w-5 shrink-0 text-emerald-trust" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-emerald-trust">
                  {coupon.codigo}
                </span>
                <span className="text-xs text-fg-muted">
                  {coupon.tipo_descuento === "porcentaje"
                    ? `${coupon.valor}% de descuento`
                    : `$${coupon.valor} de descuento`}
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-trust/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-trust">
                {formatDiscount(coupon)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-fg-dim">
          Aplica el cupón directamente con el vendedor al confirmar la compra
          en el chat de VICINO.
        </p>
      </BottomSheet>
    </>
  );
}
