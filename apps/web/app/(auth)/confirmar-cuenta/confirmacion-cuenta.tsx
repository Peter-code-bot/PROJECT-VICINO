"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from "@vicino/shared";
import { confirmarDocumentosCuenta } from "@/app/actions/legal";
import { conTope } from "@/lib/auth/con-tope";

export function ConfirmacionCuenta({ userId, destino, terminosVersion, avisoVersion }: {
  userId: string; destino: string; terminosVersion: typeof TERMINOS_VERSION; avisoVersion: typeof AVISO_PRIVACIDAD_VERSION;
}) {
  const router = useRouter();
  const [terminos, setTerminos] = useState(false);
  const [aviso, setAviso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  return <form className="space-y-5" onSubmit={async event => {
    event.preventDefault();
    if (submitting.current || !terminos || !aviso) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await conTope(confirmarDocumentosCuenta({ expectedUserId: userId, terminosVersion, avisoVersion, aceptaTerminos: true, acusaAviso: true }));
      if ("error" in result) { setError(result.error ?? "No pudimos guardar la confirmación."); return; }
      router.replace(destino); router.refresh();
    } catch {
      setError("No pudimos comprobar si se guardó. Puedes reintentar: tu confirmación no se duplicará.");
    } finally { submitting.current = false; setBusy(false); }
  }}>
    <fieldset disabled={busy} className="space-y-4">
      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-border p-4">
        <input type="checkbox" checked={terminos} onChange={event => setTerminos(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand" />
        <span>Acepto los <Link href="/terminos" target="_blank" rel="noopener noreferrer" className="underline">Términos y Condiciones</Link><span className="block text-sm text-fg-muted">Versión {terminosVersion}</span></span>
      </label>
      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-border p-4">
        <input type="checkbox" checked={aviso} onChange={event => setAviso(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand" />
        <span>He leído el <Link href="/privacidad" target="_blank" rel="noopener noreferrer" className="underline">Aviso de Privacidad</Link><span className="block text-sm text-fg-muted">Versión {avisoVersion}</span></span>
      </label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="submit" disabled={busy || !terminos || !aviso} className="min-h-12 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Guardando…" : "Aceptar y continuar"}</button>
  </form>;
}
