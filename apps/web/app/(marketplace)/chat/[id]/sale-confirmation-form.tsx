"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { createSaleConfirmation } from "../actions";
import type { ProductoChat } from "@/lib/chat/producto-activo";

const drafts = new Map<string, { price: string; quantity: string; notes: string; uncertain: boolean; operation: { key: string; signature: string } | null }>();

interface SaleConfirmationFormProps {
  chatId: string;
  currentUserId: string;
  product: ProductoChat | null;
  productRevision: number;
  onClose: () => void;
  onCreated?: () => void;
}

export function SaleConfirmationForm({
  chatId,
  currentUserId,
  product,
  productRevision,
  onClose,
  onCreated,
}: SaleConfirmationFormProps) {
  const [precio, setPrecio] = useState(product?.precio?.toString() ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const operation = useRef<{ key: string; signature: string } | null>(null);
  const draftKey = `${currentUserId}:${chatId}:${product?.id}:${productRevision}`;
  useEffect(() => {
    const saved = drafts.get(draftKey);
    let active = true;
    if (saved) {
      queueMicrotask(() => {
        if (!active) return;
        setPrecio(saved.price); setCantidad(saved.quantity); setNotas(saved.notes); setUncertain(saved.uncertain); operation.current = saved.operation;
      });
    }
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    drafts.set(draftKey, { price: precio, quantity: cantidad, notes: notas, uncertain, operation: operation.current });
    if (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  }, [draftKey, precio, cantidad, notas, uncertain, loading]);
  const eligible = !!product && product.estatus === "disponible" && !product.is_hidden;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || !eligible || submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);

    const payload = {
      productId: product.id,
      chatId,
      precioAcordado: Number(precio),
      cantidad: Number(cantidad),
      notas: notas.trim() || undefined,
      expectedRevision: productRevision,
    };
    const signature = JSON.stringify(payload);
    if (!operation.current || operation.current.signature !== signature) {
      operation.current = { key: crypto.randomUUID(), signature };
    }

    try {
      const result = await createSaleConfirmation({
        ...payload,
        idempotencyKey: operation.current.key,
      });
      if (!mounted.current) return;
      if ("error" in result && result.error) {
        setError(result.error);
        setUncertain(previous => result.code === "INVALID_INPUT" ? false : previous || !result.code || result.code === "UNAVAILABLE");
        return;
      }
      onCreated?.();
      drafts.delete(draftKey);
      onClose();
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setError("No pudimos comprobar el resultado. Reintenta con los mismos datos; no se creará otra confirmación.");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  return (
    <div className="max-h-[45vh] shrink-0 overflow-y-auto px-4 py-3 border-b bg-muted space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Confirmar venta
        </h3>
        <button
          type="button"
          aria-label="Cerrar confirmación"
          disabled={loading}
          onClick={onClose}
          className="min-h-12 min-w-12 text-muted-foreground hover:text-foreground flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">{error}</p>
      )}

      {product && (
        <details className="group text-sm text-fg-muted">
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 line-clamp-2 break-words font-semibold group-open:line-clamp-none">{product.titulo}</span>
            <span className="sr-only">Ver nombre completo</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
        </details>
      )}
      <p className="text-sm text-fg-muted">
        {product?.creador_id === currentUserId
          ? "Envía sólo tras entregar; el comprador confirmará la recepción."
          : "Envía sólo tras recibir; el vendedor confirmará la entrega."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <fieldset disabled={loading || uncertain} className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="sale-price" className="text-xs font-medium text-muted-foreground block mb-1">
              Total acordado (MXN)
            </label>
            <input
              id="sale-price"
              type="number"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
              min={0.01}
              step="0.01"
              placeholder="0.00"
              className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sale-quantity" className="text-xs font-medium text-muted-foreground block mb-1">
              Cantidad
            </label>
            <input
              id="sale-quantity"
              type="number"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              required
              min={1}
              max={9999}
              step={1}
              className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="sale-notes" className="text-xs font-medium text-muted-foreground block mb-1">
              Notas (opcional)
            </label>
            <input
              id="sale-notes"
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Acuerdos adicionales"
              maxLength={1000}
              className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={loading || !eligible}
          className="w-full min-h-12 rounded-md bg-brand hover:bg-brand-dark text-white px-3 py-2 text-sm font-medium disabled:opacity-50 transition-colors flex items-center justify-center shadow-sm"
        >
          {loading ? "Enviando..." : "Iniciar Confirmación"}
        </button>
      </form>
    </div>
  );
}
