"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { HistorialData } from "@/lib/historial/data";
import { HISTORIAL_PAGE_SIZE, historialHref, parseHistorialLocation, reviewHref, type HistorialTab } from "@/lib/historial/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatPrice, formatDate } from "@vicino/shared";

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

export function HistorialTabs({ data }: { data: HistorialData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [retrying, startRetry] = useTransition();
  const location = {
    ...parseHistorialLocation(Object.fromEntries(params.entries())),
    ventasPage: data.ventas.page,
    comprasPage: data.compras.page,
  };
  const tab = location.tab;
  const current = data[tab];
  const items = current.items;
  const reviewedSales = new Set(data.reviewedSales);
  const retry = () => startRetry(() => router.refresh());
  const setTab = (next: HistorialTab) => window.history.replaceState(null, "", historialHref({ ...location, tab: next }));
  const pageHref = (page: number) => historialHref({ ...location, [tab === "ventas" ? "ventasPage" : "comprasPage"]: page });
  const errorMessage = (message: string) => (
    <div role="alert" className="rounded-[var(--r-xl)] border border-[color:var(--border)] p-4 text-sm space-y-2">
      <p>{message}</p>
      <button type="button" onClick={retry} disabled={retrying} className="min-h-11 font-medium text-[color:var(--brand-hi)] disabled:opacity-50">
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      {/* Tabs */}
      <div role="group" aria-label="Tipo de historial" className="grid grid-cols-2 gap-1 bg-[color:var(--card-2)] rounded-[var(--r-pill)] p-1">
        <button
          type="button"
          aria-pressed={tab === "ventas"}
          onClick={() => setTab("ventas")}
          className={cn(
            "min-w-0 min-h-11 inline-flex flex-wrap justify-center items-center gap-x-2 gap-y-1 px-2 py-2 text-sm font-medium rounded-[var(--r-pill)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-hi)]",
            tab === "ventas"
              ? "bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] font-semibold"
              : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          Mis ventas
          <span className="bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] text-[10px] rounded-[var(--r-pill)] px-1.5">
            {data.ventas.total ?? "—"}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "compras"}
          onClick={() => setTab("compras")}
          className={cn(
            "min-w-0 min-h-11 inline-flex flex-wrap justify-center items-center gap-x-2 gap-y-1 px-2 py-2 text-sm font-medium rounded-[var(--r-pill)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-hi)]",
            tab === "compras"
              ? "bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] font-semibold"
              : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          Mis compras
          <span className="bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] text-[10px] rounded-[var(--r-pill)] px-1.5">
            {data.compras.total ?? "—"}
          </span>
        </button>
      </div>

      {/* Stats Bar (only for ventas tab) */}
      {tab === "ventas" && data.stats && (
        <div className="grid grid-cols-3 divide-x divide-[color:var(--border)] bg-[color:var(--card-2)] rounded-[var(--r-xl)] border border-[color:var(--border)] mb-4">
          {/* EN CURSO */}
          <div className="min-w-0 flex flex-col items-center text-center py-3 px-2 gap-1 [overflow-wrap:anywhere]">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {data.stats.enCurso}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              EN CURSO
            </span>
          </div>
          {/* COMPLETADAS */}
          <div className="min-w-0 flex flex-col items-center text-center py-3 px-2 gap-1 [overflow-wrap:anywhere]">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {data.stats.completadas}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              COMPLETADAS
            </span>
          </div>
          {/* ÚLTIMOS 7 DÍAS */}
          <div className="min-w-0 flex flex-col items-center text-center py-3 px-2 gap-1 [overflow-wrap:anywhere]">
            <span className="text-xl font-bold text-[color:var(--trust-gold)]">
              {data.stats.ultimosSieteDias}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
              ÚLTIMOS 7 DÍAS
            </span>
          </div>
        </div>
      )}

      {tab === "ventas" && !data.stats && errorMessage("No pudimos cargar las estadísticas de ventas.")}
      {data.reviewsError && !current.error && errorMessage("No pudimos comprobar tus reseñas. Reintenta para poder dejar una reseña.")}
      <div aria-live="polite" className="sr-only">{retrying ? "Actualizando historial" : ""}</div>
      {/* Items */}
      {current.error ? errorMessage(`No pudimos cargar tus ${tab}.`) : items.length > 0 ? (
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
            const canReview = item.status === "completed" && !hasReviewed && !data.reviewsError;
            const status = STATUS_LABELS[item.status] ?? { label: item.status, color: "" };
            const trustLevel = otherUser?.trust_level;
            const trustBadgeClass =
              trustLevel && trustLevel !== "nuevo"
                ? TRUST_BADGE_CLASSES[trustLevel] ?? TRUST_BADGE_CLASSES.verificado
                : null;

            return (
              <div
                key={item.id}
                className="min-w-0 rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 space-y-3 [overflow-wrap:anywhere]"
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <h3 className="min-w-0 flex-1 basis-40 font-medium text-sm text-[color:var(--fg)]">
                    {product?.titulo ?? "Producto"}
                  </h3>
                  <span className={cn("max-w-full", status.color)}>
                    {status.label}
                  </span>
                </div>

                {item.created_at && (
                  <div className="text-right text-xs text-[color:var(--fg-dim)]">
                    {formatDate(item.created_at)}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)] text-xs font-bold flex items-center justify-center shrink-0">
                    {otherUser?.nombre?.charAt(0).toUpperCase() ?? "U"}
                  </span>
                  <span className="text-xs text-[color:var(--fg-dim)]">
                    {tab === "ventas" ? "Comprador" : "Vendedor"}
                  </span>
                  <span className="min-w-0 flex-1 basis-28 text-sm text-[color:var(--fg)]">
                    {otherUser?.nombre ?? "Usuario"}
                  </span>
                  {trustBadgeClass && (
                    <span
                      className={cn(
                        "max-w-full rounded-[var(--r-pill)] px-2 py-0.5 text-[10px] font-semibold capitalize",
                        trustBadgeClass
                      )}
                    >
                      {trustLevel}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="min-w-0 max-w-full font-semibold text-sm text-[color:var(--fg)]">
                    {formatPrice(item.precio_acordado)}
                    {item.cantidad > 1 && ` x${item.cantidad}`}
                  </span>

                  {canReview && (
                    <Link
                      href={reviewHref(item.id, location)}
                      className="min-h-11 max-w-full inline-flex items-center rounded-lg text-xs font-medium text-[color:var(--brand-hi)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-hi)]"
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
      {!current.error && current.total !== null && current.total > HISTORIAL_PAGE_SIZE && (
        <nav aria-label={`Páginas de ${tab}`} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {current.page > 1 && <Link href={pageHref(current.page - 1)} className="min-h-11 inline-flex items-center text-[color:var(--brand-hi)]">Anterior</Link>}
          <span>Página {current.page} de {Math.ceil(current.total / HISTORIAL_PAGE_SIZE)}</span>
          {current.page * HISTORIAL_PAGE_SIZE < current.total && <Link href={pageHref(current.page + 1)} className="min-h-11 inline-flex items-center text-[color:var(--brand-hi)]">Siguiente</Link>}
        </nav>
      )}
    </div>
  );
}
