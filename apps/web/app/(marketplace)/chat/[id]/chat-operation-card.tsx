"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Clock, X } from "lucide-react";
import { formatPrice } from "@vicino/shared";
import type { ChatOperation, OperationProposal } from "@/lib/chat/operations";
import { cn } from "@/lib/utils";

export interface ChatOperationCardProps {
  operation: ChatOperation; currentUserId: string; expanded: boolean; onToggle: () => void;
  busy: boolean; disabled?: boolean; error?: string; onBeforeProduct?: () => void;
  onAction: (action: "accept" | "confirm" | "reject", proposal?: OperationProposal) => Promise<boolean>;
}
const labels: Record<ChatOperation["status"], string> = {
  requested: "Solicitud de compra", accepted: "Compra aceptada", pending_confirmation: "Confirmación pendiente",
  completed: "Venta completada", rejected: "Venta rechazada", cancelled: "Venta cancelada", expired: "Venta vencida", legacy: "Solicitud anterior",
};
const control = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";

export function ChatOperationCard({ operation: op, currentUserId, expanded, onToggle, busy, disabled, error, onAction, onBeforeProduct }: ChatOperationCardProps) {
  const detailId = useId();
  const [proposing, setProposing] = useState(false);
  const [price, setPrice] = useState(op.price?.toString() ?? "");
  const [quantity, setQuantity] = useState(op.quantity.toString());
  const [notes, setNotes] = useState(op.notes ?? "");
  const isBuyer = currentUserId === op.buyerId;
  const terminal = ["completed", "rejected", "cancelled", "expired", "legacy"].includes(op.status);
  const detailTitle = op.kind === "service" ? "Servicio" : "Producto";
  const confirmLabel = isBuyer ? (op.kind === "service" ? "Confirmar servicio recibido" : "Confirmar recepción") : "Confirmar venta";
  const productHref = op.product?.slug ? `/${encodeURIComponent(op.product.categoria)}/${encodeURIComponent(op.product.slug)}` : null;
  async function submitProposal(event: React.FormEvent) {
    event.preventDefault();
    if (await onAction("accept", { price: Number(price), quantity: Number(quantity), notes: notes.trim() || undefined })) setProposing(false);
  }
  return (
    <section aria-label={`Operación: ${op.title}`} className="min-w-0 space-y-2 rounded-2xl border border-border bg-card p-3 text-fg font-sans">
      <div className="flex flex-wrap items-start gap-2">
        <h3 className="min-w-0 flex-1 line-clamp-2 break-words font-display text-base font-semibold leading-snug">{op.title}</h3>
        <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-card-2 px-2 py-1 text-xs font-medium", op.status === "completed" && "bg-brand-tint text-brand-hi")}>
          {op.status === "completed" ? <Check size={14} aria-hidden /> : terminal ? <X size={14} aria-hidden /> : <Clock size={14} aria-hidden />}
          {labels[op.status]}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
        <span className="font-display font-semibold text-brand-hi">{op.price === null ? "Por acordar" : `${formatPrice(op.price)} MXN total`}</span>
        <span>{op.quantity} {op.quantity === 1 ? "unidad" : "unidades"}</span>
      </div>
      {op.status === "accepted" && <p className="text-sm text-fg-muted">Falta confirmar recepción.</p>}
      {op.status === "legacy" && <p className="text-sm text-fg-muted">Esta solicitud no conserva condiciones verificables. Abre la publicación y envía una solicitud nueva, o acuerden la operación con Confirmar venta.</p>}
      {!terminal && <p className="text-sm text-fg-muted">
        {op.canRespond ? "Al confirmar aceptas la compra. Se completará cuando el comprador confirme que la recibió."
          : op.status === "requested" ? "Solicitud enviada. El vendedor debe aceptar la compra antes de que puedas confirmar la recepción."
            : op.canConfirm ? isBuyer ? "Confirma cuando hayas recibido y revisado el producto o servicio, la cantidad y el importe." : "Confirma tu parte cuando hayas entregado el producto o realizado el servicio."
            : "Ya confirmaste tu parte. Esperando la confirmación de la otra persona."}
      </p>}
      <div className="flex flex-wrap items-center justify-between gap-1">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailId} className={cn(control, "text-brand-hi")}>
          {expanded ? "Ocultar detalles" : "Ver detalles"}<ChevronDown size={16} aria-hidden className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
        {productHref ? <Link href={productHref} onNavigate={onBeforeProduct} className={cn(control, "text-brand-hi")}>
          Ver producto <ArrowUpRight size={16} aria-hidden />
        </Link> : <span className="text-sm text-fg-muted">Producto no disponible</span>}
      </div>
      <div id={detailId} hidden={!expanded} className="space-y-2 rounded-xl bg-card-2 p-3 text-sm break-words">
        <p><strong>{detailTitle}:</strong> {op.title}</p>
        <p><strong>Precio acordado total:</strong> {op.price === null ? "Por acordar" : `${formatPrice(op.price)} MXN`} por {op.quantity} {op.quantity === 1 ? "unidad" : "unidades"}.</p>
        {op.notes && <p><strong>Notas:</strong> {op.notes}</p>}
        <p><strong>Tú:</strong> {isBuyer ? "comprador" : "vendedor"}. <strong>Contraparte:</strong> {isBuyer ? "vendedor" : "comprador"}.</p>
        <p><strong>Inició:</strong> {op.initiatedBy === currentUserId ? "Tú" : "La contraparte"}.</p>
        <p><strong>Fecha:</strong> <time dateTime={op.createdAt}>{new Date(op.createdAt).toLocaleString("es-MX")}</time></p>
        {op.completedAt && <p>Completada: <time dateTime={op.completedAt}>{new Date(op.completedAt).toLocaleString("es-MX")}</time></p>}
        {op.cancelledAt && <p>Cancelada: <time dateTime={op.cancelledAt}>{new Date(op.cancelledAt).toLocaleString("es-MX")}</time></p>}
        {op.cancelReason && <p>Motivo: {op.cancelReason}</p>}
        <p>{op.buyerConfirmed ? "Comprador confirmado" : "Comprador pendiente"} · {op.sellerConfirmed ? "Vendedor confirmado" : "Vendedor pendiente"}</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-card-2 p-2 text-sm text-danger">{error}</p>}
      {busy && <p role="status" className="text-sm text-fg-muted">Guardando respuesta…</p>}
      {op.canRespond && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || disabled} onClick={() => op.price === null ? setProposing(true) : void onAction("accept")} className={cn(control, "flex-1 bg-brand text-white")}>Confirmar venta</button>
        <button type="button" disabled={busy || disabled} onClick={() => setProposing(value => !value)} className={cn(control, "border border-border bg-card-2")}>Ajustar condiciones</button>
      </div>}
      {proposing && op.canRespond && <form onSubmit={submitProposal} className="space-y-2 rounded-xl bg-card-2 p-3">
        <p className="text-sm">Propón el total y la cantidad acordados. El comprador revisará estas condiciones antes de confirmar la recepción.</p>
        <label className="block text-sm">Precio acordado total (MXN)<input aria-label="Precio acordado total (MXN)" required type="number" min="0.01" max="99999999" step="0.01" value={price} onChange={e => setPrice(e.target.value)} disabled={busy} className="mt-1 min-h-12 w-full rounded-lg border border-border bg-card px-3" /></label>
        <label className="block text-sm">Cantidad<input aria-label="Cantidad" required type="number" min="1" max="9999" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy} className="mt-1 min-h-12 w-full rounded-lg border border-border bg-card px-3" /></label>
        <label className="block text-sm">Notas (opcional)<textarea aria-label="Notas (opcional)" maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} className="mt-1 min-h-12 w-full rounded-lg border border-border bg-card px-3 py-2" /></label>
        <button disabled={busy || disabled} className={cn(control, "w-full bg-brand text-white")}>Enviar propuesta</button>
      </form>}
      {(op.canConfirm || op.canReject) && <div className="flex flex-wrap gap-2">
        {op.canConfirm && <button type="button" onClick={() => void onAction("confirm")} disabled={busy || disabled} className={cn(control, "flex-1 bg-brand text-white")}>{confirmLabel}</button>}
        {op.canReject && <button type="button" onClick={() => void onAction("reject")} disabled={busy || disabled} className={cn(control, "flex-1 border border-border bg-card-2")}>{op.saleId && currentUserId === op.initiatedBy ? "Cancelar confirmación" : "Rechazar venta"}</button>}
      </div>}
      {op.status === "completed" && op.saleId && op.productId && <Link href={`/historial/review?sale=${op.saleId}&type=${isBuyer ? "buyer_to_seller" : "seller_to_buyer"}&product=${op.productId}`} onNavigate={onBeforeProduct} className={cn(control, "w-full text-brand-hi")}>Escribir reseña verificada</Link>}
    </section>
  );
}
