"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
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
  const isInitiator = currentUserId === sc.initiated_by;
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
    ? "border-emerald-trust/30 bg-emerald-trust/5"
    : "border-warning/30 bg-warning/5";

  return (
    <div className={`rounded-lg border p-3 space-y-2 text-xs text-fg ${statusColor}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg">
          {isCompleted ? "✅ Venta confirmada" : "🤝 Confirmación de venta"}
        </span>
        {isCompleted ? (
          <CheckCheck className="h-4 w-4 text-emerald-trust" />
        ) : (
          <Clock className="h-4 w-4 text-warning" />
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
        <span className={sc.buyer_confirmed ? "text-emerald-trust font-medium" : "text-fg-muted"}>
          {sc.buyer_confirmed ? "✓" : "○"} Comprador
        </span>
        <span className={sc.seller_confirmed ? "text-emerald-trust font-medium" : "text-fg-muted"}>
          {sc.seller_confirmed ? "✓" : "○"} Vendedor
        </span>
      </div>

      {error && (
        <p className="text-[10px] text-danger">{error}</p>
      )}

      {/* Action buttons */}
      {canConfirm && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md bg-emerald-trust text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-trust/90 disabled:opacity-50 transition-colors"
          >
            <Check className="h-3 w-3" />
            Confirmar
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md border border-border text-fg px-3 py-1.5 text-xs font-medium hover:bg-bg-elev-2 disabled:opacity-50 transition-colors"
          >
            <X className="h-3 w-3" />
            Rechazar
          </button>
        </div>
      )}

      {myConfirmed && !otherConfirmed && !isCompleted && (
        <p className="text-[10px] text-warning">
          Esperando confirmación del {isBuyer ? "vendedor" : "comprador"}...
        </p>
      )}

      {isCompleted && (
        <a
          href={`/historial`}
          className="inline-block text-emerald-trust font-medium underline hover:text-emerald-trust/80 transition-colors"
        >
          Deja tu reseña →
        </a>
      )}
    </div>
  );
}
