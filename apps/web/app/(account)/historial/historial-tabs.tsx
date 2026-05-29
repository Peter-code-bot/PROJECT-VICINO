"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatPrice, formatDate } from "@vicino/shared";

interface SaleItem {
  id: string;
  precio_acordado: number;
  cantidad: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  buyer_id: string;
  seller_id: string;
  products_services: { id: string; titulo: string; imagen_principal: string | null } | { id: string; titulo: string; imagen_principal: string | null }[] | null;
  buyer?: { nombre: string; trust_level?: string } | { nombre: string; trust_level?: string }[] | null;
  seller?: { nombre: string; trust_level?: string } | { nombre: string; trust_level?: string }[] | null;
}

interface HistorialTabsProps {
  ventas: SaleItem[];
  compras: SaleItem[];
  reviewedSales: Set<string>;
  currentUserId: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_confirmation: {
    label: "Pendiente",
    color:
      "bg-amber-400/10 text-amber-400 border border-amber-400/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
  },
  completed: {
    label: "Completada",
    color:
      "bg-[color:var(--brand-tint)] text-[color:var(--trust-emerald)] border border-[color:var(--trust-emerald)]/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
  },
  cancelled: {
    label: "Cancelada",
    color:
      "bg-[color:var(--danger)]/10 text-[color:var(--danger)] border border-[color:var(--danger)]/30 rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
  },
  expired: {
    label: "Expirada",
    color:
      "bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] border border-[color:var(--border)] rounded-[var(--r-pill)] text-xs px-2 py-0.5 font-medium",
  },
};

const TRUST_BADGE_CLASSES: Record<string, string> = {
  verificado:
    "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] border border-[color:var(--brand-tint-strong)]",
  confiable:
    "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] border border-[color:var(--brand-tint-strong)]",
  estrella:
    "bg-[rgba(212,168,83,0.18)] text-[color:var(--trust-gold)] border border-[rgba(212,168,83,0.30)]",
  elite:
    "bg-[rgba(212,168,83,0.22)] text-[color:var(--trust-gold)] border border-[rgba(212,168,83,0.36)]",
};

export function HistorialTabs({
  ventas,
  compras,
  reviewedSales,
}: HistorialTabsProps) {
  const [tab, setTab] = useState<"ventas" | "compras">("ventas");
  const items = tab === "ventas" ? ventas : compras;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const enCurso = ventas.filter((v) => v.status === "pending_confirmation").length;
  const completadas = ventas.filter((v) => v.status === "completed").length;
  const estaSemana = ventas.filter((v) => new Date(v.created_at) >= weekAgo).length;

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-[color:var(--card-2)] rounded-[var(--r-pill)] p-1 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setTab("ventas")}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
            tab === "ventas"
              ? "bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] font-semibold"
              : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          Mis ventas
          <span className="bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] text-[10px] rounded-[var(--r-pill)] px-1.5">
            {ventas.length}
          </span>
        </button>
        <button
          onClick={() => setTab("compras")}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors",
            tab === "compras"
              ? "bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] font-semibold"
              : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          Mis compras
          <span className="bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] text-[10px] rounded-[var(--r-pill)] px-1.5">
            {compras.length}
          </span>
        </button>
      </div>

      {/* Stats Bar (only for ventas tab) */}
      {tab === "ventas" && (
        <div className="grid grid-cols-3 divide-x divide-[color:var(--border)] bg-[color:var(--card-2)] rounded-[var(--r-xl)] border border-[color:var(--border)] mb-4">
          {/* EN CURSO */}
          <div className="flex flex-col items-center py-3 px-2 gap-1">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {enCurso}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              EN CURSO
            </span>
          </div>
          {/* COMPLETADAS */}
          <div className="flex flex-col items-center py-3 px-2 gap-1">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {completadas}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              COMPLETADAS
            </span>
          </div>
          {/* ESTA SEMANA */}
          <div className="flex flex-col items-center py-3 px-2 gap-1">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {estaSemana}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              ESTA SEMANA
            </span>
          </div>
        </div>
      )}

      {/* Items */}
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => {
            const product = Array.isArray(item.products_services)
              ? item.products_services[0]
              : item.products_services;
            const otherUser = tab === "ventas"
              ? (Array.isArray(item.buyer) ? item.buyer[0] : item.buyer)
              : (Array.isArray(item.seller) ? item.seller[0] : item.seller);

            const reviewType = tab === "ventas" ? "seller_to_buyer" : "buyer_to_seller";
            const hasReviewed = reviewedSales.has(`${item.id}-${reviewType}`);
            const canReview = item.status === "completed" && !hasReviewed;
            const status = STATUS_LABELS[item.status] ?? { label: item.status, color: "" };
            const trustLevel = otherUser?.trust_level;
            const trustBadgeClass =
              trustLevel && trustLevel !== "nuevo"
                ? TRUST_BADGE_CLASSES[trustLevel] ?? TRUST_BADGE_CLASSES.verificado
                : null;

            return (
              <div
                key={item.id}
                className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-sm text-[color:var(--fg)] truncate">
                    {product?.titulo ?? "Producto"}
                  </h3>
                  <span className={status.color}>
                    {status.label}
                  </span>
                </div>

                <div className="flex">
                  <span className="text-xs text-[color:var(--fg-dim)] ml-auto">
                    {formatDate(item.created_at)}
                  </span>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)] text-xs font-bold flex items-center justify-center shrink-0">
                    {otherUser?.nombre?.charAt(0).toUpperCase() ?? "U"}
                  </span>
                  <span className="text-xs text-[color:var(--fg-dim)]">
                    {tab === "ventas" ? "Comprador" : "Vendedor"}
                  </span>
                  <span className="text-sm text-[color:var(--fg)] truncate">
                    {otherUser?.nombre ?? "Usuario"}
                  </span>
                  {trustBadgeClass && (
                    <span
                      className={cn(
                        "shrink-0 rounded-[var(--r-pill)] px-2 py-0.5 text-[10px] font-semibold capitalize",
                        trustBadgeClass
                      )}
                    >
                      {trustLevel}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-sm text-[color:var(--fg)]">
                    {formatPrice(item.precio_acordado)}
                    {item.cantidad > 1 && ` x${item.cantidad}`}
                  </span>

                  {canReview && (
                    <Link
                      href={`/historial/review?sale=${item.id}&type=${reviewType}&product=${product?.id}`}
                      className="text-xs font-medium text-[color:var(--brand-hi)] hover:underline"
                    >
                      Dejar reseña →
                    </Link>
                  )}

                  {hasReviewed && (
                    <span className="text-xs text-[color:var(--trust-emerald)]">✓ Reseña dejada</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">{tab === "ventas" ? "📦" : "🛍️"}</p>
          <p className="font-medium">
            {tab === "ventas" ? "Sin ventas aún" : "Sin compras aún"}
          </p>
        </div>
      )}
    </div>
  );
}
