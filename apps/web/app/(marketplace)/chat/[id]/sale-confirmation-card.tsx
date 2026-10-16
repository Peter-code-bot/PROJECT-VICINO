"use client";

import { useState } from "react";
import { Check, X, Clock, CheckCheck, Handshake, ShieldCheck, Star, MessageSquare, MapPin, Footprints, Wallet, ArrowLeftRight, ChevronDown, type LucideIcon } from "lucide-react";
import { confirmSale, cancelSale } from "../actions";
import { formatPrice } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { hapticMedium } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { posterUrl } from "@/lib/video-thumbnail";
import styles from "./sale-confirmation.module.css";

export type ConfirmationStatus = "pendiente" | "esperando" | "completado" | "rechazado";

export interface SaleConfirmation {
  id: string;
  product_id: string;
  buyer_id: string;
  seller_id: string;
  precio_acordado: number;
  cantidad: number;
  metodo_pago: string | null;
  // Nulable en la base. El render ya compara con "pickup", asi que una
  // confirmacion sin tipo cae sola en la otra rama, que es la que ya se
  // pintaba para cualquier valor distinto.
  tipo_entrega: string | null;
  status: string;
  initiated_by: string;
  // Nulables en la base (DEFAULT false). Se leen como "todavia no confirmo",
  // que es como ya los trataba el codigo: myConfirmed/otherConfirmed alimentan
  // condiciones donde null y false son indistinguibles.
  buyer_confirmed: boolean | null;
  seller_confirmed: boolean | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  // Nulable en la base (DEFAULT now()).
  created_at: string | null;
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

const statusLabels: Record<ConfirmationStatus, string> = {
  pendiente: "Pendiente",
  esperando: "Esperando respuesta",
  completado: "Completado",
  rechazado: "Rechazado",
};

export function StatusPill({ status, label }: { status: ConfirmationStatus; label?: string }) {
  const Icon = status === "completado" ? Check : status === "rechazado" ? X : Clock;
  return (
    <span className={styles.status} data-status={status}>
      <Icon size={14} aria-hidden="true" />
      <span>{label || statusLabels[status]}</span>
    </span>
  );
}

export function SaleConfirmationBanner({
  status, label, expanded, controlsId, onToggle,
}: {
  status: ConfirmationStatus;
  label: string;
  expanded: boolean;
  controlsId: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={cn(styles.surface, styles.banner)}
      aria-expanded={expanded} aria-controls={controlsId} onClick={onToggle}>
      <span className={styles.icon}><Handshake size={18} aria-hidden="true" /></span>
      <span className={styles.bannerContent}>
        <span className={styles.bannerTitle}>Confirmación de venta</span>
        <StatusPill status={status} label={label} />
      </span>
      <span className={styles.toggle}>
        {expanded ? "Ocultar" : "Ver detalles"}
        <ChevronDown size={16} aria-hidden="true" className={cn(expanded && styles.expanded)} />
      </span>
    </button>
  );
}

function MetaCell({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <Icon size={18} aria-hidden="true" className={styles.accent} />
      <div className={styles.flexContent}>
        <div className={styles.label}>{label}</div>
        <div className={styles.metaValue}>{value}</div>
      </div>
    </div>
  );
}

function ConfirmStep({ stepState, avatarUrl, initial, label }: {
  stepState: "done" | "pending" | "rejected";
  avatarUrl?: string | null;
  initial?: string;
  label: string;
}) {
  const status = stepState === "done" ? "completado" : stepState === "pending" ? "pendiente" : "rechazado";
  return (
    <div className={styles.step}>
      {avatarUrl ? <img src={avatarUrl} alt="" className={styles.avatar} /> :
        <span className={styles.avatar}>{initial}</span>}
      <span className={styles.person}>{label}</span>
      <StatusPill status={status} label={stepState === "done" ? "Confirmado" : undefined} />
    </div>
  );
}

function ProductThumb({ url, fallback, rejected }: { url?: string | null; fallback: string; rejected?: boolean }) {
  return (
    <div className={styles.thumb}>
      {url ? <img src={posterUrl(url)} alt="" className={cn(rejected && styles.rejectedImage)} /> :
        <span>{fallback[0]}</span>}
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
  // A5.4: optimistic overlay separate from the derived status. The
  // overlay flips the StatusPill within the same render frame as the
  // tap; the derived status (computed from `sc` props) catches up when
  // the parent re-renders after revalidatePath. effectiveStatus =
  // optimisticStatus ?? derivedStatus -- the overlay wins while present
  // and yields to the authoritative server-truth once cleared.
  //
  // Two distinct optimistic targets (handled by two separate
  // useOptimisticMutation calls -- one per Server Action):
  //   confirm -> "esperando" (I confirmed, waiting for the other party)
  //   cancel  -> "rechazado" (sale is dead)
  //
  // The wrapper's rollback (returned from onMutate) restores the
  // previous overlay snapshot on error, so the pill returns to the
  // derived status with NO orphan state.
  const [optimisticStatus, setOptimisticStatus] = useState<ConfirmationStatus | null>(null);

  const confirmMutation = useOptimisticMutation(confirmSale, {
    onMutate: () => {
      // Haptic in onMutate (consistent with favorite-button), fires
      // EXACTLY once per user tap. NOT in the rollback function below
      // -- rollback is a silent state restore, no haptic on revert.
      void hapticMedium();
      const previous = optimisticStatus;
      setOptimisticStatus("esperando");
      // CODEX M2 fix: functional updater so we only revert the value
      // WE wrote. If a concurrent cancel mutation has overwritten the
      // overlay after our onMutate but before our rollback, we leave
      // its newer value in place rather than restoring a stale snapshot.
      return () => setOptimisticStatus((curr) => (curr === "esperando" ? previous : curr));
    },
    onSuccess: () => {
      // Server succeeded + revalidatePath -> parent will re-render with
      // updated `sc`, derived status will be authoritative. Clear the
      // overlay so derivedStatus wins through effectiveStatus. For
      // confirm specifically this is correct because the card stays
      // mounted and transitions to "esperando" (one party confirmed,
      // other pending) -- derivedStatus will agree after Realtime UPDATE
      // flips buyer_confirmed/seller_confirmed.
      setOptimisticStatus(null);
    },
  });

  const cancelMutation = useOptimisticMutation(cancelSale, {
    onMutate: () => {
      void hapticMedium();
      const previous = optimisticStatus;
      setOptimisticStatus("rechazado");
      // CODEX M2 fix: same functional-updater pattern as confirm above.
      return () => setOptimisticStatus((curr) => (curr === "rechazado" ? previous : curr));
    },
    // CODEX M1 fix: DO NOT clear the overlay on success.
    //
    // cancelSale writes status="cancelled" + cancelled_by on the DB row.
    // The SSR query in chat/[id]/page.tsx filters .in("status", ["pending_confirmation",
    // "completed"]) and the Realtime UPDATE handler in chat-window.tsx
    // removes any row whose new status is NOT in that visible list.
    // The card therefore UNMOUNTS via parent state cleanup on success;
    // it never re-renders with sc.status === "cancelled" reaching the
    // derivedStatus computation (the derivedStatus "rechazado" branch is
    // effectively unreachable from real server data).
    //
    // If we cleared the overlay here, effectiveStatus would briefly
    // collapse to derivedStatus = "pendiente" -- the user would see the
    // pill flip back to Pendiente during the gap between this onSuccess
    // and Realtime delivering the UPDATE that removes the card. With
    // the clear omitted, the overlay holds "rechazado" until unmount,
    // which is both visually consistent and harmless (the overlay state
    // is dropped with the component).
  });

  const isPending = confirmMutation.isPending || cancelMutation.isPending;
  const error = confirmMutation.error ?? cancelMutation.error ?? "";

  const productData = Array.isArray(sc.products_services)
    ? sc.products_services[0]
    : sc.products_services;
  const productTitle = productData?.titulo ?? "Producto";
  const productImg = productData?.imagen_principal;

  const isBuyer = currentUserId === sc.buyer_id;
  // ?? false explicito: la columna admite nulo y "sin confirmar" es
  // exactamente lo que significa un nulo aqui.
  const myConfirmed = (isBuyer ? sc.buyer_confirmed : sc.seller_confirmed) ?? false;
  const otherConfirmed = (isBuyer ? sc.seller_confirmed : sc.buyer_confirmed) ?? false;
  const isCompleted = sc.status === "completed";

  let derivedStatus: ConfirmationStatus = "pendiente";
  if (sc.status === "cancelled" || sc.status === "rejected" || sc.cancelled_by) {
    derivedStatus = "rechazado";
  } else if (isCompleted) {
    derivedStatus = "completado";
  } else if (myConfirmed && !otherConfirmed) {
    derivedStatus = "esperando";
  }

  // A5.4: the overlay wins while non-null; once mutation.onSuccess
  // clears it, the parent's revalidated `sc` drives derivedStatus and
  // effectiveStatus collapses back to the authoritative server view.
  const effectiveStatus: ConfirmationStatus = optimisticStatus ?? derivedStatus;

  const rejected = effectiveStatus === "rechazado";
  const done = effectiveStatus === "completado";

  // Step indicators reflect the OPTIMISTIC view: when the user taps
  // Confirm, their own step flips to "done" within the same frame
  // (myConfirmed-OR-optimistic-confirm). Cancel flips to "rejected"
  // for whichever side triggered it (the current user, since cancel
  // is the path through this card's CTA).
  const optimisticMyConfirmed = optimisticStatus === "esperando" ? true : myConfirmed;
  const optimisticRejectedByMe = optimisticStatus === "rechazado";

  const myStepState =
    (rejected && (sc.cancelled_by === currentUserId || optimisticRejectedByMe))
      ? "rejected"
      : (optimisticMyConfirmed ? "done" : "pending");
  const otherStepState =
    rejected && sc.cancelled_by !== currentUserId && sc.cancelled_by != null
      ? "rejected"
      : otherConfirmed
        ? "done"
        : "pending";

  function handleConfirm() {
    void confirmMutation.mutate(sc.id);
  }

  function handleCancel() {
    void cancelMutation.mutate(sc.id);
  }

  const otherName = counterpart?.name || "Usuario";
  const myInitial = currentUser?.initial || "Y";
  
  const paymentMethodStr = sc.metodo_pago ? sc.metodo_pago.charAt(0).toUpperCase() + sc.metodo_pago.slice(1) : "Acordar";

  return (
    <section className={cn(styles.surface, styles.card)} aria-label="Detalle de confirmación de venta">
      <header className={styles.header}>
        <span className={styles.icon}>
          {done ? <CheckCheck size={20} aria-hidden="true" /> : rejected ?
            <X size={20} aria-hidden="true" /> : <Handshake size={20} aria-hidden="true" />}
        </span>
        <div className={styles.flexContent}>
          <h3 className={styles.title}>{done ? "Venta confirmada" : rejected ? "Venta rechazada" : "Confirmación de venta"}</h3>
          <div role="status" aria-live="polite"><StatusPill status={effectiveStatus} /></div>
        </div>
      </header>

      <div className={styles.product}>
        <ProductThumb url={productImg} fallback={productTitle} rejected={rejected} />
        <div className={styles.flexContent}>
          <div className={styles.label}>Producto</div>
          <div className={cn(styles.productTitle, rejected && styles.struck)}>{productTitle}</div>
          <div className={cn(styles.price, rejected && styles.struck)}>
            {formatPrice(sc.precio_acordado) ?? "Sin precio"} <span>MXN</span>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <MetaCell icon={sc.tipo_entrega === "pickup" ? Footprints : MapPin} label="Entrega"
          value={sc.tipo_entrega === "pickup" ? "Recoger en persona" : "Envío a domicilio"} />
        <MetaCell icon={Wallet} label="Pago" value={paymentMethodStr} />
      </div>

      <div className={styles.steps}>
        <p className={styles.stepTitle}>{done ? "Ambos confirmaron" : rejected ? "Estado de la confirmación" : "Ambos deben confirmar"}</p>
        <ConfirmStep stepState={myStepState} initial={myInitial} label="Tú" />
        <ConfirmStep stepState={otherStepState} avatarUrl={counterpart?.avatarUrl} initial={otherName[0]} label={otherName} />
      </div>

      <div className={styles.trust}>
        {done ? <Star size={18} aria-hidden="true" /> : rejected ?
          <MessageSquare size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
        <div>
          {done ? (
            <>Trato cerrado · <strong>deja una reseña a {otherName}</strong> para sumar trust score.</>
          ) : rejected ? (
            <>Esta confirmación fue cancelada. Pueden <strong>seguir negociando</strong> en este chat o cerrar la conversación.</>
          ) : (
            <>VICINO sólo conecta. El pago se acuerda en persona — confirma sólo cuando hayas recibido el trato.</>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {isPending && <p className={styles.waiting} role="status">Guardando respuesta…</p>}
        {effectiveStatus === "pendiente" && (
          <div className={styles.actions}>
            <button type="button" onClick={handleConfirm} disabled={isPending} aria-busy={isPending}
              className={cn(styles.action, styles.primary)}>
              <Check size={18} aria-hidden="true" /><span>Confirmar venta</span>
            </button>
            <button type="button" onClick={handleCancel} disabled={isPending} className={cn(styles.action, styles.secondary)}>
              <X size={18} aria-hidden="true" /><span>Rechazar</span>
            </button>
          </div>
        )}
        {effectiveStatus === "esperando" && (
          <p className={styles.waiting}>Ya confirmaste tu parte. Esperando a <strong>{otherName}</strong>...</p>
        )}
        {effectiveStatus === "completado" && (
          <button type="button" onClick={onRate} className={cn(styles.action, styles.secondary)}>
            <Star size={18} aria-hidden="true" /><span>Calificar a {otherName}</span>
          </button>
        )}
        {effectiveStatus === "rechazado" && (
          <div className={styles.actions}>
            <button type="button" onClick={onPropose} disabled={isPending} className={cn(styles.action, styles.primary)}>
              <ArrowLeftRight size={18} aria-hidden="true" /><span>Nueva propuesta</span>
            </button>
            <button type="button" disabled={isPending} className={cn(styles.action, styles.secondary)}>
              <MessageSquare size={18} aria-hidden="true" /><span>Seguir chat</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
