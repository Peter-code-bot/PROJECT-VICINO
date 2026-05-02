"use client";

import { useTransition } from "react";
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const productTitle = Array.isArray(sc.products_services)
    ? sc.products_services[0]?.titulo
    : sc.products_services?.titulo;

  const isBuyer = currentUserId === sc.buyer_id;
  const myConfirmed = isBuyer ? sc.buyer_confirmed : sc.seller_confirmed;
  const otherConfirmed = isBuyer ? sc.seller_confirmed : sc.buyer_confirmed;
  const isInitiator = currentUserId === sc.initiated_by;
  const isCompleted = sc.status === "completed";
  const canConfirm = !myConfirmed && sc.status === "pending_confirmation";

  function handleConfirm() {
    if (isPending || myConfirmed || sc.status !== "pending_confirmation") return;
    startTransition(async () => {
      await confirmSale(sc.id);
      router.refresh();
    });
  }

  function handleCancel() {
    if (isPending || sc.status !== "pending_confirmation") return;
    startTransition(async () => {
      await cancelSale(sc.id);
      router.refresh();
    });
  }

  const statusColor = isCompleted
    ? "border-emerald-500/30 bg-muted"
    : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30";

  return (
    <div className={`rounded-lg border p-3 space-y-2 text-xs ${statusColor}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {isCompleted ? "✅ Venta confirmada" : "🤝 Confirmación de venta"}
        </span>
        {isCompleted ? (
          <CheckCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
        <span className={sc.buyer_confirmed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
          {sc.buyer_confirmed ? "✓" : "○"} Comprador
        </span>
        <span className={sc.seller_confirmed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
          {sc.seller_confirmed ? "✓" : "○"} Vendedor
        </span>
      </div>

      {/* Action buttons */}
      {canConfirm && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
            Confirmar
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            Rechazar
          </button>
        </div>
      )}

      {myConfirmed && !otherConfirmed && !isCompleted && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          Esperando confirmación del {isBuyer ? "vendedor" : "comprador"}...
        </p>
      )}

      {isCompleted && (
        <a
          href={`/historial`}
          className="inline-block text-green-700 dark:text-green-400 underline"
        >
          Deja tu reseña →
        </a>
      )}
    </div>
  );
}
