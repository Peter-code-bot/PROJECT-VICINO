"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { cancelarCanje, enlaceGoogleWallet, iniciarCanje } from "../actions";

interface CanjePendiente {
  id: string;
  codigo: string;
  expires_at: string;
  premio: string;
}

interface AccionesTarjetaProps {
  membershipId: string;
  sellos: number;
  meta: number;
  premio: string;
  activa: boolean;
  canjePendiente: CanjePendiente | null;
  wallet: { apple: boolean; google: boolean };
  pases: Array<{ proveedor: "apple" | "google"; emitido_at: string | null; guardado_at: string | null }>;
}

const primario =
  "inline-flex w-full items-center justify-center rounded-[var(--r-pill)] bg-[color:var(--fg)] px-4 py-3 text-sm font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60";
const secundario =
  "inline-flex w-full items-center justify-center rounded-[var(--r-pill)] border border-[color:var(--border)] px-4 py-3 text-sm font-semibold text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)] disabled:opacity-60";

function segundosRestantes(expiraEn: string, ahora: number): number {
  return Math.max(0, Math.floor((Date.parse(expiraEn) - ahora) / 1000));
}

/**
 * Canjear (codigo de un solo uso que el negocio teclea), cancelar y añadir a
 * las carteras. Los botones de Wallet solo aparecen si el servidor tiene
 * credenciales de ese proveedor; mientras, la tarjeta vive aqui.
 */
export function AccionesTarjeta({ membershipId, sellos, meta, premio, activa, canjePendiente, wallet, pases }: AccionesTarjetaProps) {
  const router = useRouter();
  const [canje, setCanje] = useState<CanjePendiente | null>(canjePendiente);
  // 0 en servidor y en el primer render del cliente (sin desajuste de
  // hidratacion); el reloj arranca en el efecto.
  const [ahora, setAhora] = useState(0);
  const [enCurso, iniciar] = useTransition();
  const [abriendoGoogle, setAbriendoGoogle] = useState(false);

  // La prop puede cambiar tras router.refresh(); se adopta sin un efecto.
  const [canjeProp, setCanjeProp] = useState(canjePendiente);
  if (canjeProp !== canjePendiente) {
    setCanjeProp(canjePendiente);
    setCanje(canjePendiente);
  }

  // Mientras hay un codigo en pantalla: reloj cada segundo y, cada 8 s, se
  // vuelve a pedir la pagina para enterarse de que el negocio ya confirmo
  // (la prop canjePendiente llega null y el saldo nuevo con ella).
  useEffect(() => {
    if (!canje) return;
    let tics = 0;
    const temporizador = setInterval(() => {
      tics += 1;
      setAhora(Date.now());
      if (tics % 8 === 0) router.refresh();
    }, 1000);
    return () => clearInterval(temporizador);
  }, [canje, router]);

  const restante = canje && ahora > 0 ? segundosRestantes(canje.expires_at, ahora) : null;
  const vencido = canje !== null && restante === 0;

  useEffect(() => {
    if (vencido) router.refresh();
  }, [vencido, router]);

  function canjear() {
    iniciar(async () => {
      const resultado = await iniciarCanje(membershipId, crypto.randomUUID());
      if (resultado.error || !resultado.canje) {
        toast.error(resultado.error ?? "No se pudo iniciar el canje.");
        return;
      }
      setCanje(resultado.canje);
      setAhora(Date.now());
    });
  }

  function cancelar() {
    if (!canje) return;
    const id = canje.id;
    iniciar(async () => {
      const resultado = await cancelarCanje(id, membershipId);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      setCanje(null);
      router.refresh();
    });
  }

  async function abrirGoogle() {
    setAbriendoGoogle(true);
    try {
      const resultado = await enlaceGoogleWallet(membershipId).catch(
        (): { url?: string; error?: string } => ({ error: "Sin conexión. Inténtalo de nuevo." }),
      );
      // Defensa en profundidad: el enlace lo firma el servidor, pero solo se abre si es de Google.
      if (resultado.error || !resultado.url || !resultado.url.startsWith("https://pay.google.com/")) {
        toast.error(resultado.error ?? "No se pudo preparar tu tarjeta para Google Wallet.");
        return;
      }
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: resultado.url, presentationStyle: "popover" });
      } else {
        window.location.assign(resultado.url);
      }
    } finally {
      setAbriendoGoogle(false);
    }
  }

  const paseApple = pases.find((p) => p.proveedor === "apple");
  const paseGoogle = pases.find((p) => p.proveedor === "google");

  return (
    <div className="mt-4 space-y-3">
      {canje && !vencido ? (
        <div className="space-y-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 text-center">
          <p className="text-sm font-semibold text-[color:var(--fg)]">Muestra este código al negocio</p>
          <p className="font-mono text-4xl font-bold tracking-[0.25em] text-[color:var(--fg)]" aria-live="polite">
            {canje.codigo}
          </p>
          <p className="text-xs text-[color:var(--fg-muted)]">
            {canje.premio}
            {restante !== null ? ` · vence en ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")}` : ""}
          </p>
          <button type="button" onClick={cancelar} disabled={enCurso} className={secundario}>
            {enCurso ? "Cancelando…" : "Cancelar canje"}
          </button>
        </div>
      ) : vencido ? (
        <div className="space-y-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 text-center">
          <p className="text-sm text-[color:var(--fg-muted)]">El código venció sin usarse. Puedes generar otro.</p>
          <button type="button" onClick={canjear} disabled={enCurso || !activa} className={primario}>
            {enCurso ? "Generando…" : "Generar otro código"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={canjear} disabled={enCurso || !activa || sellos < meta} className={primario}>
          {enCurso ? "Generando…" : sellos >= meta ? `Canjear ${premio}` : `Canjear premio (${sellos} de ${meta})`}
        </button>
      )}

      {wallet.apple || wallet.google ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {wallet.apple ? (
            <a href={`/api/wallet/apple/pase/${membershipId}`} className={secundario}>
              {paseApple?.guardado_at ? "Actualizar en Apple Wallet" : "Añadir a Apple Wallet"}
            </a>
          ) : null}
          {wallet.google ? (
            <button type="button" onClick={abrirGoogle} disabled={abriendoGoogle} className={secundario}>
              {abriendoGoogle ? "Preparando…" : paseGoogle?.emitido_at ? "Abrir en Google Wallet" : "Añadir a Google Wallet"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-xs text-[color:var(--fg-muted)]">
          Pronto podrás guardar esta tarjeta en Apple Wallet y Google Wallet.
        </p>
      )}
    </div>
  );
}
