"use client";

import type { OnboardingSession } from "@/app/(onboarding)/completar-perfil/onboarding-session";
import { useEffect, useRef } from "react";

/** Shared recovery stays above the question, including on the path selector. */
export function OnboardingSaveStatus({ session, busy, onRetry, error: localError }: {
  session: OnboardingSession; busy: boolean; onRetry: () => void; error?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const error = session.error || localError;
  useEffect(() => {
    if (!error) return;
    const frame = requestAnimationFrame(() => {
      const scroll = container.current?.closest<HTMLElement>("[data-onboarding-scroll]");
      if (scroll) scroll.scrollTop = 0;
      const alert = container.current?.querySelector<HTMLElement>("[role=alert]");
      if (alert) { alert.tabIndex = -1; alert.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [error]);
  if (!session.pending && !error && !session.finalPending) return null;
  return <div ref={container} data-onboarding-save-status className="mb-5 space-y-3">
    {session.pending > 0 && <p role="status" className="text-sm text-fg-muted">
      {session.error ? "Hay pasos pendientes de guardar." : "Guardando tu avance…"}
    </p>}
    {error && <div className="space-y-3 rounded-xl border border-danger p-3 text-sm">
      <p role="alert">{error}</p>
      {session.error && <>
      {!session.conflict && <button type="button" disabled={busy} className="min-h-12 rounded-xl border border-border px-4 font-medium" onClick={onRetry}>Reintentar guardado</button>}
      {session.uncertain ? <><p className="text-fg-muted">Aún no sabemos si este paso se guardó. Conservaremos la misma operación para comprobarlo.</p>
        <button type="button" disabled={busy} className="min-h-12 rounded-xl px-4 font-medium underline" onClick={() => window.location.reload()}>Recargar y recuperar</button></>
        : <><p className="text-fg-muted">Volver al avance guardado descarta los pasos y ediciones que siguen pendientes en esta sesión.</p>
          <button type="button" disabled={busy || session.finalPending} className="min-h-12 rounded-xl px-4 font-medium underline" onClick={session.recoverConfirmed}>Volver al avance guardado</button></>}
      </>}
    </div>}
    {session.finalPending && <p role="status" className="text-sm text-fg-muted">Falta confirmar tu entrada. Al reintentar conservaremos tu decisión anterior.</p>}
  </div>;
}
