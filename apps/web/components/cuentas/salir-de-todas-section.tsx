"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { useLogout } from "@/hooks/use-logout";
import { useCuentas } from "@/lib/cuentas/use-cuentas";
import { cn } from "@/lib/utils";
import { ConfirmacionCuenta } from "./confirmacion-cuenta";

/** Salida total solo en Configuración, con una confirmación independiente. */
export function SalirDeTodasSection({ agrupado = false }: { agrupado?: boolean }) {
  const cuentas = useCuentas();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const ocupadoRef = useRef(false);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const logout = useLogout();

  async function handleConfirm() {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setLoading(true);
    try {
      const result = await logout({ todas: true });
      if (result.error) toast.error(result.error);
      else setConfirming(false);
    } finally {
      ocupadoRef.current = false;
      setLoading(false);
    }
  }

  if (cuentas.length < 2 && !confirming) return null;

  return (
    <>
      <button ref={disparadorRef} type="button" onClick={() => setConfirming(true)} disabled={loading}
        aria-label="Salir de todas las cuentas"
        className={cn(
          "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-sm font-medium text-[color:var(--danger)] transition-colors hover:bg-muted disabled:opacity-60",
          agrupado ? "shadow-[inset_0_-1px_0_0_var(--border)]" : "rounded-xl bg-[color:var(--sidebar-bg)]",
        )}>
        <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
        Salir de todas las cuentas ({cuentas.length})
      </button>
      <ConfirmacionCuenta open={confirming} onClose={() => setConfirming(false)} titulo="¿Salir de todas las cuentas?"
        descripcion="Se cerrarán las sesiones guardadas en este teléfono. La cuenta activa también se cerrará en tus otros dispositivos. Tendrás que volver a iniciar sesión."
        confirmar="Confirmar salir de todas las cuentas" pendiente={loading} onConfirmar={() => void handleConfirm()}
        restaurarFoco={() => {
          if (disparadorRef.current?.isConnected) disparadorRef.current.focus();
          else document.getElementById("sesion-configuracion-titulo")?.focus();
        }} />
    </>
  );
}
