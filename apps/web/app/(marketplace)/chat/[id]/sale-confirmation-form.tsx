"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Package, Send, X } from "lucide-react";
import { createSaleConfirmation } from "../actions";
import type { ProductoChat } from "@/lib/chat/producto-activo";
import { importeVenta, precioFijo, totalPrecioFijo } from "@/lib/chat/precio-confirmacion";
import { posterUrl } from "@/lib/video-thumbnail";
import styles from "./sale-confirmation-form.module.css";

type Quote = { fixed: boolean; unitPrice: number | null };
const drafts = new Map<string, { price: string; quantity: string; notes: string; quote: Quote; uncertain: boolean; stale: boolean; operation: { key: string; signature: string } | null }>();

interface SaleConfirmationFormProps {
  chatId: string;
  currentUserId: string;
  product: ProductoChat | null;
  productRevision: number;
  onClose: () => void;
  onCreated?: () => void;
  onProductRefresh?: () => void;
}

export function SaleConfirmationForm({
  chatId,
  currentUserId,
  product,
  productRevision,
  onClose,
  onCreated,
  onProductRefresh,
}: SaleConfirmationFormProps) {
  const [precio, setPrecio] = useState(product?.precio?.toString() ?? "");
  const [cantidad, setCantidad] = useState("1");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  // Freeze the displayed offer for this draft, including an ambiguous retry.
  // Catalog refreshes must never silently change the submitted amount.
  const [quote, setQuote] = useState<Quote>({ fixed: precioFijo(product), unitPrice: product?.precio ?? null });
  const [imageFailed, setImageFailed] = useState(false);
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
        setPrecio(saved.price); setCantidad(saved.quantity); setNotas(saved.notes); setQuote(saved.quote);
        setUncertain(saved.uncertain); setStale(saved.stale); operation.current = saved.operation;
      });
    }
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    drafts.set(draftKey, { price: precio, quantity: cantidad, notes: notas, quote, uncertain, stale, operation: operation.current });
    if (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  }, [draftKey, precio, cantidad, notas, quote, uncertain, stale, loading]);
  const eligible = !!product && product.estatus === "disponible" && !product.is_hidden;
  const fixedTotal = totalPrecioFijo(quote.unitPrice, cantidad);
  const invalidTotal = quote.fixed && fixedTotal === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const agreedTotal = quote.fixed ? fixedTotal : Number(precio);
    if (!product || !eligible || stale || agreedTotal === null || submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(true);

    const payload = {
      productId: product.id,
      chatId,
      precioAcordado: agreedTotal,
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
        if (result.code === "PRICE_CHANGED") setStale(true);
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
    <section aria-labelledby="sale-form-title" className={styles.panel}>
      <div className={styles.header}>
        <h3 id="sale-form-title" className={styles.heading}>Confirmar venta</h3>
        <button
          type="button"
          aria-label="Cerrar confirmación"
          disabled={loading}
          onClick={onClose}
          className={styles.close}
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {error && (
        <p role="alert" className={styles.error}>{error}</p>
      )}
      {stale && (
        <button type="button" className={styles.refresh} onClick={() => {
          drafts.delete(draftKey);
          onProductRefresh?.();
          onClose();
        }}>Cerrar y actualizar producto</button>
      )}

      <form onSubmit={handleSubmit} aria-label="Datos de la venta" className={styles.form}>
        <fieldset disabled={loading || uncertain || stale} className={styles.fields}>
          <div className={styles.product}>
            <div className={styles.thumbnail} aria-hidden>
              {product?.imagen_principal && !imageFailed ? (
                // Product media may be a video; use its existing poster convention.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={posterUrl(product.imagen_principal)} alt="" onError={() => setImageFailed(true)} />
              ) : <Package size={24} />}
            </div>
            <div className={styles.productInfo}>
              {product && (
                <details className={styles.productName}>
                  <summary aria-label={"Ver nombre completo: " + product.titulo}>
                    <span>{product.titulo}</span>
                    <ChevronDown size={14} aria-hidden />
                  </summary>
                </details>
              )}
              {quote.fixed ? (
                <output aria-label="Total de la venta" aria-live="polite" className={styles.price}>
                  <strong>{fixedTotal === null ? "—" : importeVenta(fixedTotal)}</strong>
                  <span> MXN total</span>
                </output>
              ) : <>
                <label htmlFor="sale-price" className={styles.label}>Total acordado (MXN)</label>
                <input
                  id="sale-price"
                  aria-label="Total acordado (MXN)"
                  type="number"
                  inputMode="decimal"
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  required
                  min={0.01}
                  max={99_999_999}
                  step="0.01"
                  placeholder="0.00"
                  className={styles.input}
                />
              </>}
            </div>
          </div>
          <div className={styles.quantityField}>
            <label htmlFor="sale-quantity" className={styles.label}>
              <span aria-hidden>Cant.</span><span className="sr-only">Cantidad</span>
            </label>
            <input
              id="sale-quantity"
              aria-label="Cantidad"
              type="number"
              inputMode="numeric"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              required
              min={1}
              max={9999}
              step={1}
              className={styles.quantity}
            />
          </div>
          <div className={styles.notesField}>
            <label htmlFor="sale-notes" className={styles.label}>
              Notas (opcional)
            </label>
            <input
              id="sale-notes"
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Notas…"
              maxLength={1000}
              className={styles.input}
            />
          </div>
        </fieldset>
        {invalidTotal && <p role="status" className={styles.guidance}>
          Revisa la cantidad y el precio del producto. El total debe ser mayor a cero y no superar $99,999,999 MXN.
        </p>}
        <p id="sale-form-guidance" className={styles.guidance}>
          {product?.creador_id === currentUserId
            ? "Tras entregar. El comprador confirmará la recepción."
            : "Tras recibir. El vendedor confirmará la entrega."}
        </p>
        <button
          type="submit"
          aria-describedby="sale-form-guidance"
          disabled={loading || !eligible || stale || invalidTotal}
          className={styles.submit}
        >
          <Send size={20} aria-hidden />
          {loading ? "Enviando..." : "Confirmar venta"}
        </button>
      </form>
    </section>
  );
}
