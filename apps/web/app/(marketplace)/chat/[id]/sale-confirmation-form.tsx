"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createSaleConfirmation } from "../actions";
import type { ProductoChat } from "@/lib/chat/producto-activo";

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
  const [metodoPago, setMetodoPago] = useState("");
  const [tipoEntrega, setTipoEntrega] = useState("pickup");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const operation = useRef<{ key: string; signature: string } | null>(null);
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
      metodoPago: metodoPago || undefined,
      notas: notas || undefined,
      tipoEntrega,
      expectedRevision: productRevision,
    };
    const signature = JSON.stringify(payload);
    if (!operation.current || operation.current.signature !== signature) operation.current = { key: crypto.randomUUID(), signature };
    try {
      const result = await createSaleConfirmation({ ...payload, idempotencyKey: operation.current.key });
      if (!mounted.current) return;
      if ("error" in result && result.error) {
        setError(result.error);
        // Un limite o una sesion vencida en el reintento no aclaran si el
        // envio anterior se confirmo. Conservar su carga hasta obtener replay.
        setUncertain(previous => previous || !result.code || result.code === "UNAVAILABLE");
        return;
      }
      onCreated?.();
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
          Confirmar Venta
        </h3>
        <button type="button" aria-label="Cerrar confirmación" disabled={loading} onClick={onClose} className="min-h-12 min-w-12 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">{error}</p>
      )}

      {product && (
        <p className="text-xs text-muted-foreground">
          Producto: <strong>{product.titulo}</strong>
          {product.creador_id === currentUserId ? " · Tú vendes" : " · Tú compras"}
        </p>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <fieldset disabled={loading || uncertain} className="col-span-2 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="sale-price" className="text-xs text-muted-foreground">Precio acordado (MXN)</label>
          <input
            id="sale-price"
            type="number"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            required
            min={1}
            step="0.01"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label htmlFor="sale-quantity" className="text-xs text-muted-foreground">Cantidad</label>
          <input
            id="sale-quantity"
            type="number"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            required
            min={1}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label htmlFor="sale-payment" className="text-xs text-muted-foreground">Método de pago</label>
          <select
            id="sale-payment"
            value={metodoPago}
            onChange={(e) => setMetodoPago(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Sin especificar</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label htmlFor="sale-delivery" className="text-xs text-muted-foreground">Entrega</label>
          <select
            id="sale-delivery"
            value={tipoEntrega}
            onChange={(e) => setTipoEntrega(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="pickup">Recoger</option>
            <option value="envio">Envío</option>
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor="sale-notes" className="text-xs text-muted-foreground">Notas (opcional)</label>
          <input
            id="sale-notes"
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Detalles adicionales..."
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        </fieldset>
        <button
          type="submit"
          disabled={loading || !eligible}
          className="col-span-2 rounded-md bg-emerald-trust hover:bg-emerald-trust/90 text-white px-3 py-2 text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? "Enviando..." : "Iniciar Confirmación"}
        </button>
      </form>
    </div>
  );
}
