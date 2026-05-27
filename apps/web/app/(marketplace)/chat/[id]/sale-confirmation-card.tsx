"use client";

import { useState } from "react";
import { Check, X, Clock, CheckCheck } from "lucide-react";
import { confirmSale, cancelSale } from "../actions";
import { formatPrice } from "@vicino/shared";

interface SaleConfirmation {
  id: string;
  product_id: string;
  buyer_id: string;
  seller_id: string;
  precio_acordado: number;
  cantidad: number;
  metodo_pago: string | null;
  tipo_entrega: string;
  status: string;
  initiated_by: string;
  buyer_confirmed: boolean;
  seller_confirmed: boolean;
  created_at: string;
  products_services: { titulo: string } | { titulo: string }[] | null;
}

interface SaleConfirmationCardProps {
  confirmation: SaleConfirmation;
  currentUserId: string;
}

export function SaleConfirmationCard({
  confirmation: sc,
  currentUserId,
}: SaleConfirmationCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isPending = loading;

  const productTitle = Array.isArray(sc.products_services)
    ? sc.products_services[0]?.titulo
    : sc.products_services?.titulo;

  const isBuyer = currentUserId === sc.buyer_id;
  const myConfirmed = isBuyer ? sc.buyer_confirmed : sc.seller_confirmed;
  const otherConfirmed = isBuyer ? sc.seller_confirmed : sc.buyer_confirmed;
  const isCompleted = sc.status === "completed";
  const canConfirm = !myConfirmed && sc.status === "pending_confirmation";

  async function handleConfirm() {
    setLoading(true);
    setError("");
    const result = await confirmSale(sc.id);
    if (result?.error) setError(result.error);
    setLoading(false);
  }

  async function handleCancel() {
    setLoading(true);
    setError("");
    const result = await cancelSale(sc.id);
    if (result?.error) setError(result.error);
    setLoading(false);
  }

  const statusColor = isCompleted
    ? "border border-[color:var(--trust-emerald)]/30 bg-[color:var(--card-2)] rounded-[var(--r-xl)] p-3"
    : "border border-[color:var(--brand-tint-strong)] bg-[color:var(--brand-tint)] rounded-[var(--r-xl)] p-3";

  return (
    <div className={`space-y-2 text-xs text-[color:var(--fg)] ${statusColor}`}>
      <div className="flex items-center justify-between">
        <span
          className={
            isCompleted
              ? "text-[color:var(--trust-emerald)] font-semibold"
              : "text-[color:var(--fg)] font-semibold"
          }
        >
          {isCompleted ? "✅ Venta confirmada" : "🤝 Confirmación de venta"}
        </span>
        {isCompleted ? (
          <CheckCheck className="h-4 w-4 text-[color:var(--trust-emerald)]" />
        ) : (
          <Clock className="h-4 w-4 text-amber-400" />
        )}
      </div>

      <div className="space-y-1">
        <p>
          <strong>{productTitle}</strong> — {formatPrice(sc.precio_acordado)}
          {sc.cantidad > 1 && ` x${sc.cantidad}`}
        </p>
        {sc.metodo_pago && <p>Pago: {sc.metodo_pago}</p>}
        <p>Entrega: {sc.tipo_entrega === "pickup" ? "Recoger" : "Envío"}</p>
      </div>

      {/* Confirmation status */}
      <div className="flex gap-2 text-[10px]">
        <span className={sc.buyer_confirmed ? "text-[color:var(--trust-emerald)] font-medium" : "text-[color:var(--fg-dim)]"}>
          {sc.buyer_confirmed ? "✓" : "○"} Comprador
        </span>
        <span className={sc.seller_confirmed ? "text-[color:var(--trust-emerald)] font-medium" : "text-[color:var(--fg-dim)]"}>
          {sc.seller_confirmed ? "✓" : "○"} Vendedor
        </span>
      </div>

      {error && (
        <p className="text-[10px] text-[color:var(--danger)]">{error}</p>
      )}

      {/* Action buttons */}
      {canConfirm && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex items-center gap-1 bg-[color:var(--brand)] text-white rounded-[var(--r-pill)] px-4 py-1.5 text-xs font-semibold hover:bg-[color:var(--brand-dark)] disabled:opacity-50 transition-colors"
          >
            <Check className="h-3 w-3" />
            Confirmar
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex items-center gap-1 border border-[color:var(--border-strong)] text-[color:var(--fg-muted)] rounded-[var(--r-pill)] px-4 py-1.5 text-xs hover:bg-[color:var(--bg-elev-2)] disabled:opacity-50 transition-colors"
          >
            <X className="h-3 w-3" />
            Rechazar
          </button>
        </div>
      )}

      {myConfirmed && !otherConfirmed && !isCompleted && (
        <p className="text-amber-400 text-[10px]">
          Esperando confirmación del {isBuyer ? "vendedor" : "comprador"}...
        </p>
      )}

      {isCompleted && (
        <a
          href={`/historial`}
          className="inline-block text-[color:var(--trust-emerald)] underline text-xs"
        >
          Deja tu reseña →
        </a>
      )}
    </div>
  );
}
