"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/ui/user-avatar";
import { actualizarTokens, guardarCuenta, quitarCuenta, type Cuenta } from "@/lib/cuentas/boveda";
import { nombreVisible } from "@/lib/cuentas/cambio";
import { reportarCuentas } from "@/lib/cuentas/puertos";
import { revocarSesion } from "@/lib/cuentas/sesion-aislada";
import { useCuentas } from "@/lib/cuentas/use-cuentas";
import { ConfirmacionCuenta } from "./confirmacion-cuenta";

/** La gestión local vive en Configuración, separada del selector frecuente. */
export function CuentasGuardadasSection({ userId }: { userId: string }) {
  const cuentas = useCuentas();
  const [confirmar, setConfirmar] = useState<Cuenta | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ocupadoRef = useRef(false);
  const abiertaRef = useRef(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const disparadorRef = useRef<HTMLButtonElement | null>(null);

  function cerrar() {
    abiertaRef.current = false;
    setConfirmar(null);
    setError(null);
  }

  async function quitar() {
    if (!confirmar || confirmar.userId === userId || ocupadoRef.current) return;
    const cuenta = confirmar;
    ocupadoRef.current = true;
    setPendiente(true);
    setError(null);
    try {
      // Misma revocación local que antes: persistir tokens rotados aunque falle
      // /logout, sin cambiar ultimoUso ni olvidar una sesión aún válida.
      const resultado = await revocarSesion(cuenta, (sesion) => {
        const tokens = { accessToken: sesion.access_token, refreshToken: sesion.refresh_token };
        if (!actualizarTokens(cuenta.userId, tokens)) guardarCuenta({ ...cuenta, ...tokens });
      });
      if (!resultado.ok) {
        reportarCuentas("revocar", resultado.error, "warning");
        const mensaje = "No se pudo quitar la cuenta. Revisa tu conexión e inténtalo de nuevo.";
        if (abiertaRef.current) setError(mensaje);
        else toast.error(mensaje);
        return;
      }
      quitarCuenta(cuenta.userId);
      cerrar();
      toast.success(`${nombreVisible(cuenta)} ya no está en este teléfono`);
    } finally {
      ocupadoRef.current = false;
      setPendiente(false);
    }
  }

  return (
    <section id="cuentas-guardadas" aria-labelledby="cuentas-guardadas-titulo" className="scroll-mt-24 space-y-2">
      <h2 id="cuentas-guardadas-titulo" ref={tituloRef} tabIndex={-1}
        className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--fg-dim)]">
        Cuentas guardadas en este teléfono
      </h2>
      <p className="px-1 text-xs text-[color:var(--fg-muted)]">Quitar una cuenta de aquí no elimina su perfil ni sus publicaciones.</p>
      <ul aria-label="Gestionar cuentas guardadas" className="overflow-hidden rounded-2xl bg-[color:var(--sidebar-bg)]">
        {cuentas.map((cuenta) => (
          <li key={cuenta.userId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-b border-border/15 px-4 py-3 last:border-b-0">
            <UserAvatar src={cuenta.foto} name={nombreVisible(cuenta)} size="md" />
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-foreground">{nombreVisible(cuenta)}</p>
              <p className="truncate text-xs text-muted-foreground">{cuenta.email}</p>
              {cuenta.userId === userId && <p className="text-xs font-medium text-[color:var(--brand)]">Cuenta activa</p>}
            </div>
            {cuenta.userId !== userId && (
              <button type="button" disabled={pendiente} aria-label={`Quitar ${nombreVisible(cuenta)} de este teléfono`}
                className="col-start-2 mt-1 inline-flex min-h-12 items-center justify-self-start rounded-lg px-3 text-sm font-medium text-[color:var(--danger)] hover:bg-muted disabled:opacity-60"
                onClick={(event) => { disparadorRef.current = event.currentTarget; setError(null); abiertaRef.current = true; setConfirmar(cuenta); }}>
                Quitar de este teléfono
              </button>
            )}
          </li>
        ))}
        {cuentas.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No hay cuentas guardadas en este teléfono.</li>}
      </ul>
      <ConfirmacionCuenta open={confirmar !== null} onClose={cerrar} titulo={`¿Quitar ${confirmar ? nombreVisible(confirmar) : "esta cuenta"}?`}
        descripcion="Se cerrará solo su sesión guardada en este teléfono. Tendrás que volver a entrar para usarla aquí; tus otros dispositivos no se cerrarán."
        confirmar={`Confirmar quitar ${confirmar ? nombreVisible(confirmar) : "cuenta"}`} pendiente={pendiente}
        onConfirmar={() => void quitar()} restaurarFoco={() => {
          if (disparadorRef.current?.isConnected) disparadorRef.current.focus();
          else tituloRef.current?.focus();
        }}>
        {error && <p role="alert" className="text-sm text-[color:var(--danger)]">{error}</p>}
      </ConfirmacionCuenta>
    </section>
  );
}
