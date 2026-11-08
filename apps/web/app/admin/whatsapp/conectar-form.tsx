"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cambiarEstadoCanalWhatsApp, conectarCanalWhatsApp, eliminarCanalWhatsApp, type EstadoConexion } from "./actions";

const INICIAL: EstadoConexion = { ok: false, mensaje: null };

const CAMPO = "w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500";

export function ConectarCanalForm() {
  const [estado, accion, pendiente] = useActionState(conectarCanalWhatsApp, INICIAL);

  return (
    <form action={accion} className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold text-sm">Conectar un número a un negocio</h2>
      <p className="text-xs text-[color:var(--fg-muted)]">
        Los dos identificadores están en Meta for Developers → tu app → WhatsApp → API Setup. El negocio se
        busca por su usuario de VICINO (sin distinguir mayúsculas).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="font-medium">Usuario del negocio en VICINO</span>
          <input name="username" type="text" required maxLength={64} placeholder="@panaderia_ana" className={CAMPO} autoComplete="off" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium">Número mostrado (opcional)</span>
          <input name="numero_mostrado" type="text" maxLength={24} placeholder="+1 555 025 3483" className={CAMPO} autoComplete="off" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium">Phone number ID</span>
          <input name="phone_number_id" type="text" required inputMode="numeric" pattern="[0-9]{5,32}" placeholder="Solo dígitos" className={CAMPO} autoComplete="off" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium">WhatsApp Business Account ID</span>
          <input name="waba_id" type="text" required inputMode="numeric" pattern="[0-9]{5,32}" placeholder="Solo dígitos" className={CAMPO} autoComplete="off" />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className={estado.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-[color:var(--danger)]"} aria-live="polite">
          {estado.mensaje ?? ""}
        </p>
        <Button type="submit" size="sm" loading={pendiente}>
          Conectar
        </Button>
      </div>
    </form>
  );
}

export function AccionesCanal({ canalId, activo, etiqueta }: { canalId: string; activo: boolean; etiqueta: string }) {
  const [pendiente, start] = useTransition();
  const [resultado, setResultado] = useState<EstadoConexion | null>(null);

  const ejecutar = (fn: () => Promise<EstadoConexion>) =>
    start(async () => {
      setResultado(await fn());
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={activo ? "secondary" : "primary"}
          loading={pendiente}
          onClick={() => {
            if (
              activo &&
              !window.confirm(`Pausar ${etiqueta}: el negocio no podrá responder hasta que lo reactives; lo que le llegue se sigue guardando. ¿Continuar?`)
            ) {
              return;
            }
            ejecutar(() => cambiarEstadoCanalWhatsApp(canalId, !activo));
          }}
        >
          {activo ? "Pausar" : "Reactivar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          loading={pendiente}
          onClick={() => {
            if (!window.confirm(`Desconectar ${etiqueta}: se borran el número, sus conversaciones y sus mensajes. No se puede deshacer. ¿Continuar?`)) return;
            ejecutar(() => eliminarCanalWhatsApp(canalId));
          }}
        >
          Desconectar
        </Button>
      </div>
      {resultado?.mensaje ? (
        <p className={resultado.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-[color:var(--danger)]"} aria-live="polite">
          {resultado.mensaje}
        </p>
      ) : null}
    </div>
  );
}
