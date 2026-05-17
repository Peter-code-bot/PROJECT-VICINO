"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createSaleConfirmation } from "../actions";

interface SaleConfirmationFormProps {
  chatId: string;
  currentUserId: string;
  product: { id: string; titulo: string; precio: number } | null;
  onClose: () => void;
}

export function SaleConfirmationForm({
  chatId,
  currentUserId,
  product,
  onClose,
}: SaleConfirmationFormProps) {
  const [precio, setPrecio] = useState(product?.precio?.toString() ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [metodoPago, setMetodoPago] = useState("");
  const [tipoEntrega, setTipoEntrega] = useState("pickup");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setError("");
    setLoading(true);

    const result = await createSaleConfirmation({
      productId: product.id,
      chatId,
      precioAcordado: Number(precio),
      cantidad: Number(cantidad),
      metodoPago: metodoPago || undefined,
      notas: notas || undefined,
      tipoEntrega,
    });

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    onClose();
  }

  return (
    <div className="px-4 py-3 border-b bg-muted space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Confirmar Venta
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {product && (
        <p className="text-xs text-muted-foreground">
          Producto: <strong>{product.titulo}</strong>
        </p>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Precio acordado (MXN)</label>
          <input
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
          <label className="text-xs text-muted-foreground">Cantidad</label>
          <input
            type="number"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            required
            min={1}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Método de pago</label>
          <select
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
          <label className="text-xs text-muted-foreground">Entrega</label>
          <select
            value={tipoEntrega}
            onChange={(e) => setTipoEntrega(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="pickup">Recoger</option>
            <option value="envio">Envío</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Notas (opcional)</label>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Detalles adicionales..."
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !product}
          className="col-span-2 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Enviando..." : "Iniciar Confirmación"}
        </button>
      </form>
    </div>
  );
}
