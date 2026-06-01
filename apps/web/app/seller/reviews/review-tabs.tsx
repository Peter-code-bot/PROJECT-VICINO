"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { formatDate } from "@vicino/shared";
import { RespondForm } from "./respond-form";

interface ReviewTabsProps {
  received: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    respuesta: string | null;
    respuesta_fecha: string | null;
    created_at: string;
    profiles: { nombre: string } | { nombre: string }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null; product_categories?: unknown }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null; product_categories?: unknown }[]
      | null;
  }>;
  given: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    profiles: { nombre: string } | { nombre: string }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null; product_categories?: unknown }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null; product_categories?: unknown }[]
      | null;
  }>;
  pending: Array<{
    id: string;
    products_services: { id: string; titulo: string } | { id: string; titulo: string }[] | null;
    buyer: { nombre: string } | { nombre: string }[] | null;
  }>;
  currentUserId: string;
}

export function ReviewTabs({ received, given, pending }: ReviewTabsProps) {
  const [tab, setTab] = useState<"received" | "given" | "pending">("received");

  const tabs = [
    { key: "received" as const, label: "Recibidas", count: received.length },
    { key: "given" as const, label: "Dejadas", count: given.length },
    { key: "pending" as const, label: "Pendientes", count: pending.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-[color:var(--card-2)] rounded-[var(--r-pill)] p-1 min-w-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 min-w-0 inline-flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] font-semibold"
                : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
            )}
          >
            <span className="truncate">{t.label}</span>
            <span className="bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] text-[10px] rounded-[var(--r-pill)] px-1.5 shrink-0">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "received" && (
        <div className="space-y-3">
          {received.length > 0 ? (
            received.map((r) => {
              const reviewer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const reviewedProduct = Array.isArray(r.products_services)
                ? r.products_services[0]
                : r.products_services;
              return (
                <div key={r.id} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 space-y-2 overflow-hidden min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <span className="font-medium text-sm truncate min-w-0 flex-1 basis-[8rem]">{reviewer?.nombre ?? "Usuario"}</span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="text-xs text-[color:var(--fg-muted)] ml-auto shrink-0 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('es-MX', {day: '2-digit', month: '2-digit', year: '2-digit'})}</span>
                  </div>
                  {r.comentario && <p className="text-sm text-[color:var(--fg-muted)] break-words">{r.comentario}</p>}
                  {r.respuesta ? (
                    <div className="ml-4 pl-3 border-l border-[color:var(--border)] text-sm">
                      <span className="font-medium">Tu respuesta:</span>{" "}
                      <span className="text-[color:var(--fg-muted)]">{r.respuesta}</span>
                    </div>
                  ) : (
                    <RespondForm reviewId={r.id} />
                  )}
                  <div className="pt-2 border-t border-[color:var(--border)]">
                    <ReviewProductLink product={reviewedProduct ?? null} />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[color:var(--fg-muted)] py-8 text-center">Sin reseñas recibidas</p>
          )}
        </div>
      )}

      {tab === "given" && (
        <div className="space-y-3">
          {given.length > 0 ? (
            given.map((r) => {
              const reviewed = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const reviewedProduct = Array.isArray(r.products_services)
                ? r.products_services[0]
                : r.products_services;
              return (
                <div key={r.id} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 space-y-2 overflow-hidden min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <span className="text-sm truncate min-w-0 flex-1 basis-[8rem]">Para: <strong>{reviewed?.nombre ?? "Usuario"}</strong></span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="text-xs text-[color:var(--fg-muted)] ml-auto shrink-0 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('es-MX', {day: '2-digit', month: '2-digit', year: '2-digit'})}</span>
                  </div>
                  {r.comentario && <p className="text-sm text-[color:var(--fg-muted)] break-words">{r.comentario}</p>}
                  <div className="pt-2 border-t border-[color:var(--border)]">
                    <ReviewProductLink product={reviewedProduct ?? null} />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[color:var(--fg-muted)] py-8 text-center">Sin reseñas dejadas</p>
          )}
        </div>
      )}

      {tab === "pending" && (
        <div className="space-y-3">
          {pending.length > 0 ? (
            pending.map((s) => {
              const product = Array.isArray(s.products_services) ? s.products_services[0] : s.products_services;
              const buyer = Array.isArray(s.buyer) ? s.buyer[0] : s.buyer;
              return (
                <div key={s.id} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 flex items-center justify-between gap-3 overflow-hidden min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{product?.titulo ?? "Producto"}</p>
                    <p className="text-xs text-[color:var(--fg-muted)] truncate">Comprador: {buyer?.nombre ?? "Usuario"}</p>
                  </div>
                  <Link
                    href={`/historial/review?sale=${s.id}&type=seller_to_buyer&product=${product?.id ?? ""}`}
                    className="text-xs font-medium text-[color:var(--brand-hi)] hover:underline shrink-0 whitespace-nowrap"
                  >
                    Evaluar →
                  </Link>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[color:var(--fg-muted)] py-8 text-center">Sin reseñas pendientes</p>
          )}
        </div>
      )}
    </div>
  );
}
