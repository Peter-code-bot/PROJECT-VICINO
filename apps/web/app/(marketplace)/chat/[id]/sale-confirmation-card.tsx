"use client";

import { useState } from "react";
import { Check, X, Clock, CheckCheck, Handshake, ShieldCheck, Star, MessageSquare, MapPin, Footprints, Wallet, ArrowLeftRight, ChevronDown } from "lucide-react";
import { confirmSale, cancelSale } from "../actions";
import { formatPrice } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { hapticMedium } from "@/lib/haptics";

export type ConfirmationStatus = "pendiente" | "esperando" | "completado" | "rechazado";

export interface SaleConfirmation {
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
  rejected_by?: "comprador" | "vendedor";
  rejected_at?: string;
  created_at: string;
  products_services: { titulo: string; imagen_principal?: string | null } | { titulo: string; imagen_principal?: string | null }[] | null;
}

interface SaleConfirmationCardProps {
  confirmation: SaleConfirmation;
  currentUserId: string;
  counterpart?: { name: string; avatarUrl?: string | null; role: "comprador" | "vendedor" };
  currentUser?: { initial: string; role: "comprador" | "vendedor" };
  onRate?: () => void;
  onPropose?: () => void;
}

export function StatusPill({ status, label }: { status: ConfirmationStatus, label?: string }) {
  if (status === "pendiente") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-amber-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        {label || "Pendiente"}
      </span>
    );
  }
  if (status === "esperando") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-amber-400">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        {label || "Esperando respuesta"}
      </span>
    );
  }
  if (status === "completado") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[color:var(--trust-emerald)]">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--trust-emerald)]"></span>
        {label || "Completado"}
      </span>
    );
  }
  if (status === "rechazado") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[color:var(--danger)]">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--danger)]"></span>
        {label || "Rechazado"}
      </span>
    );
  }
  return null;
}

function MetaCell({ icon: Icon, label, value, dim = false }: { icon: any, label: string, value: string, dim?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", dim && "opacity-55")}>
      <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-bold uppercase tracking-wider text-[color:var(--fg-dim)]">{label}</div>
        <div className="truncate text-xs font-semibold text-[color:var(--fg)]">{value}</div>
      </div>
    </div>
  );
}

function ConfirmStep({
  stepState,
  avatarUrl,
  initial,
  label,
  isRejected
}: {
  stepState: "done" | "pending" | "rejected";
  avatarUrl?: string | null;
  initial?: string;
  label: string;
  isRejected?: boolean;
}) {
  return (
    <div className="relative flex items-center gap-3">
      <div className={cn(
        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_2px_currentColor]",
        stepState === "done" && "bg-[color:var(--brand)] text-white shadow-[inset_0_0_0_2px_var(--brand-hi)]",
        stepState === "pending" && "bg-amber-400/15 text-amber-400 shadow-[inset_0_0_0_2px_transparent]",
        stepState === "rejected" && "bg-[rgba(255,59,48,0.18)] text-[color:var(--danger)] shadow-[inset_0_0_0_2px_transparent]"
      )}>
        {stepState === "done" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {stepState === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
        {stepState === "rejected" && <X className="h-3.5 w-3.5" strokeWidth={3} />}
      </div>
      <div className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1.5 shadow-[inset_0_0_0_1px_currentColor]",
        stepState === "done" && "bg-[rgba(46,135,115,0.08)] text-[color:var(--brand-tint-strong)]",
        stepState === "pending" && "bg-white/[0.025] text-[color:var(--border)]",
        stepState === "rejected" && "bg-[rgba(255,59,48,0.06)] text-[rgba(255,59,48,0.22)]"
      )}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[color:var(--card-2)] text-[10px] font-bold text-[color:var(--fg-muted)]">
            {initial}
          </div>
        )}
        <span className="truncate text-xs font-semibold text-[color:var(--fg)]">{label}</span>
        <span className={cn(
          "ml-auto text-[9px] font-bold uppercase tracking-wider",
          stepState === "done" && "text-[color:var(--brand-hi)]",
          stepState === "pending" && "text-amber-400",
          stepState === "rejected" && "text-[color:var(--danger)]"
        )}>
          {stepState === "done" ? "CONFIRMADO" : stepState === "pending" ? "PENDIENTE" : "RECHAZADO"}
        </span>
      </div>
    </div>
  );
}

function ProductThumb({ url, fallback, rejected }: { url?: string | null, fallback: string, rejected?: boolean }) {
  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
      {url ? (
        <img src={url} alt="" className={cn("h-full w-full object-cover", rejected && "opacity-50 grayscale")} />
      ) : (
        <span className="text-xl font-bold text-[color:var(--fg-muted)]">{fallback[0]}</span>
      )}
      {rejected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <X className="h-6 w-6 text-[color:var(--danger)]" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}

export function SaleConfirmationCard({
  confirmation: sc,
  currentUserId,
  counterpart,
  currentUser,
  onRate,
  onPropose
}: SaleConfirmationCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isPending = loading;

  const productData = Array.isArray(sc.products_services)
    ? sc.products_services[0]
    : sc.products_services;
  const productTitle = productData?.titulo ?? "Producto";
  const productImg = productData?.imagen_principal;

  const isBuyer = currentUserId === sc.buyer_id;
  const myConfirmed = isBuyer ? sc.buyer_confirmed : sc.seller_confirmed;
  const otherConfirmed = isBuyer ? sc.seller_confirmed : sc.buyer_confirmed;
  const isCompleted = sc.status === "completed";
  
  let status: ConfirmationStatus = "pendiente";
  if (sc.status === "rejected" || sc.rejected_by) {
    status = "rechazado";
  } else if (isCompleted) {
    status = "completado";
  } else if (myConfirmed && !otherConfirmed) {
    status = "esperando";
  }

  const rejected = status === "rechazado";
  const done = status === "completado";

  const myRole = isBuyer ? "comprador" : "vendedor";
  const otherRole = isBuyer ? "vendedor" : "comprador";

  const myStepState = rejected && sc.rejected_by === myRole ? "rejected" : (myConfirmed ? "done" : "pending");
  const otherStepState = rejected && sc.rejected_by === otherRole ? "rejected" : (otherConfirmed ? "done" : "pending");

  async function handleConfirm() {
    void hapticMedium();
    setLoading(true);
    setError("");
    const result = await confirmSale(sc.id);
    if (result?.error) setError(result.error);
    setLoading(false);
  }

  async function handleCancel() {
    void hapticMedium();
    setLoading(true);
    setError("");
    const result = await cancelSale(sc.id);
    if (result?.error) setError(result.error);
    setLoading(false);
  }

  const otherName = counterpart?.name || "Usuario";
  const myInitial = currentUser?.initial || "Y";
  
  const paymentMethodStr = sc.metodo_pago ? sc.metodo_pago.charAt(0).toUpperCase() + sc.metodo_pago.slice(1) : "Acordar";

  return (
    <div className={cn(
      "rounded-[var(--r-xl)] overflow-hidden transition-all duration-300 relative",
      done && "bg-gradient-to-b from-[rgba(45,143,111,0.10)] to-[color:var(--card)] shadow-[inset_0_0_0_1px_rgba(45,143,111,0.32),0_0_40px_rgba(45,143,111,0.15)]",
      rejected && "bg-gradient-to-b from-[rgba(255,59,48,0.08)] to-[color:var(--card)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.28),0_0_40px_rgba(255,59,48,0.10)]",
      !done && !rejected && "bg-gradient-to-b from-[color:var(--brand-tint)] to-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong),var(--shadow-glow)]"
    )}>
      {/* A. Header del módulo */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_0_currentColor]",
        done && "text-[rgba(45,143,111,0.15)]",
        rejected && "text-[rgba(255,59,48,0.15)]",
        !done && !rejected && "text-[color:var(--brand-tint-strong)]"
      )}>
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.2)] text-white",
          done && "bg-[color:var(--trust-emerald)]",
          rejected && "bg-[color:var(--danger)]",
          !done && !rejected && "bg-[color:var(--brand)]"
        )}>
          {done ? <CheckCheck className="h-4 w-4" /> : rejected ? <X className="h-4 w-4" /> : <Handshake className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "text-sm font-bold truncate",
            done ? "text-[color:var(--trust-emerald)]" : rejected ? "text-[color:var(--danger)]" : "text-[color:var(--fg)]"
          )}>
            {done ? "Venta confirmada" : rejected ? "Venta rechazada" : "Confirmación de venta"}
          </div>
          <StatusPill status={status} />
        </div>
      </div>

      {/* B. Sumario producto + precio */}
      <div className="px-3.5 pt-3.5 pb-2.5 flex items-start gap-3">
        <ProductThumb url={productImg} fallback={productTitle} rejected={rejected} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--fg-dim)]">Producto</div>
          <div className={cn("text-sm font-semibold mt-0.5 truncate",
            rejected ? "text-[color:var(--fg-muted)] line-through" : "text-[color:var(--fg)]")}>
            {productTitle}
          </div>
          <div className={cn("font-display text-[22px] font-bold tracking-tight mt-1 leading-none",
            rejected ? "text-[color:var(--fg-muted)] line-through" : "text-[color:var(--fg)]")}>
            ${Number(sc.precio_acordado).toLocaleString("es-MX")}{" "}
            <span className="text-[11px] font-medium text-[color:var(--fg-muted)] tracking-normal no-underline">
              MXN
            </span>
          </div>
        </div>
      </div>

      {/* C. Bloque meta */}
      <div className="px-4 py-2 grid grid-cols-2 gap-3">
        <MetaCell icon={sc.tipo_entrega === "pickup" ? Footprints : MapPin} label="Entrega" value={sc.tipo_entrega === "pickup" ? "Recoger en persona" : "Envío a domicilio"} dim={rejected} />
        <MetaCell icon={Wallet} label="Pago" value={paymentMethodStr} dim={rejected} />
      </div>

      {/* D. Stepper vertical de confirmación */}
      <div className="px-4 py-3">
        <div className="text-[11px] font-semibold text-[color:var(--fg-muted)] mb-3">
          {done ? "Ambos confirmaron" : rejected ? "Estado de la confirmación" : "Ambos deben confirmar"}
        </div>
        <div className="relative pl-1">
          <div className={cn(
            "absolute left-[14px] top-4 bottom-4 w-0.5 rounded-full",
            done && "bg-[color:var(--trust-emerald)]",
            rejected && "bg-gradient-to-b from-[color:var(--brand-hi)] to-[rgba(255,59,48,0.5)]",
            !done && !rejected && "bg-gradient-to-b from-[color:var(--brand-hi)] to-[color:var(--border)]"
          )} />
          
          <div className="space-y-4">
            <ConfirmStep
              stepState={myStepState}
              initial={myInitial}
              label="Tú"
              isRejected={rejected}
            />
            <ConfirmStep
              stepState={otherStepState}
              avatarUrl={counterpart?.avatarUrl}
              initial={otherName[0]}
              label={otherName}
              isRejected={rejected}
            />
          </div>
        </div>
      </div>

      {/* E. Trust strip permanente */}
      <div className={cn(
        "px-4 py-3 flex gap-3 text-xs leading-relaxed border-t",
        done && "bg-[rgba(45,143,111,0.10)] border-[rgba(45,143,111,0.15)]",
        rejected && "bg-white/[0.03] border-white/5",
        !done && !rejected && "bg-[rgba(46,135,115,0.08)] border-[rgba(46,135,115,0.12)]"
      )}>
        <div className="shrink-0 mt-0.5">
          {done ? <Star className="h-4 w-4 text-[color:var(--trust-gold)] fill-[color:var(--trust-gold)]" /> : 
           rejected ? <MessageSquare className="h-4 w-4 text-[color:var(--fg-muted)]" /> : 
           <ShieldCheck className="h-4 w-4 text-[color:var(--brand-hi)]" />}
        </div>
        <div className="text-[color:var(--fg-dim)]">
          {done ? (
            <>Trato cerrado · <strong className="text-[color:var(--fg)]">deja una reseña a {otherName}</strong> para sumar trust score.</>
          ) : rejected ? (
            <>Esta confirmación fue cancelada. Pueden <strong className="text-[color:var(--fg)]">seguir negociando</strong> en este chat o cerrar la conversación.</>
          ) : (
            <>VICINO sólo conecta. El pago se acuerda en persona — confirma sólo cuando hayas recibido el trato.</>
          )}
        </div>
      </div>

      {/* F. CTAs por estado */}
      <div className="p-4 pt-2">
        {error && <p className="text-[11px] text-[color:var(--danger)] mb-2 px-1">{error}</p>}
        
        {status === "pendiente" && (
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-2xl bg-[color:var(--brand)] text-white text-sm font-semibold shadow-[var(--shadow-glow)] hover:bg-[color:var(--brand-dark)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-4 w-4" />
              Confirmar venta
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-2xl bg-[color:var(--card-2)] text-[color:var(--fg-muted)] text-sm font-semibold border border-[color:var(--border)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="h-4 w-4" />
              Rechazar
            </button>
          </div>
        )}
        
        {status === "esperando" && (
          <div className="h-11 flex items-center justify-center text-xs font-medium text-[color:var(--fg-dim)]">
            Ya confirmaste tu parte. Esperando a <strong className="text-[color:var(--fg)] ml-1">{otherName}</strong>...
          </div>
        )}
        
        {status === "completado" && (
          <button
            onClick={onRate}
            className="w-full flex items-center justify-center gap-1.5 h-11 rounded-2xl bg-[color:var(--card-2)] text-[color:var(--fg)] text-sm font-semibold border border-[color:var(--border)] hover:bg-[color:var(--bg-elev-2)] transition-all"
          >
            <Star className="h-4 w-4 text-[color:var(--trust-gold)] fill-[color:var(--trust-gold)]" />
            Calificar a {otherName}
          </button>
        )}
        
        {status === "rechazado" && (
          <div className="flex gap-2">
            <button
              onClick={onPropose}
              className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-2xl bg-[color:var(--brand)] text-white text-sm font-semibold shadow-[var(--shadow-glow)] hover:bg-[color:var(--brand-dark)] transition-all"
            >
              <ArrowLeftRight className="h-4 w-4" />
              Nueva propuesta
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-2xl bg-[color:var(--card-2)] text-[color:var(--fg-muted)] text-sm font-semibold border border-[color:var(--border)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)] transition-all"
            >
              <MessageSquare className="h-4 w-4" />
              Seguir chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
