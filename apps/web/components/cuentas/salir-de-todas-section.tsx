"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { useLogout } from "@/hooks/use-logout";
import { useCuentas } from "@/lib/cuentas/use-cuentas";
import { cn } from "@/lib/utils";

/**
 * "Salir de todas las cuentas" en el grupo "Sesion" de /configuracion.
 *
 * Solo aparece cuando hay mas de una cuenta guardada: con una sola, "Cerrar
 * sesion" ya hace lo mismo. En un telefono compartido tiene que estar a un
 * toque, por eso vive aqui ademas de al pie de la hoja "Cuentas".
 *
 * `agrupado`: fila dentro del grupo, con divisor abajo (igual que LogoutSection).
 */
export function SalirDeTodasSection({ agrupado = false }: { agrupado?: boolean }) {
  const cuentas = useCuentas();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const logout = useLogout();

  if (cuentas.length < 2) return null;

  async function handleConfirm() {
    setLoading(true);
    const result = await logout({ todas: true });
    if (result.error) {
      toast.error(result.error);
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className={cn("rounded-xl bg-[rgba(255,59,48,0.08)] p-4 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]", agrupado && "m-2")}>
        <p className="mb-1 text-sm font-semibold text-[color:var(--fg)]">¿Salir de todas las cuentas?</p>
        <p className="mb-4 text-xs text-[color:var(--fg-muted)]">
          Se cerrará la sesión de las {cuentas.length} cuentas guardadas en este teléfono. Tendrás que volver a entrar en cada una.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={loading}
            aria-label="Confirmar salir de todas las cuentas"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-95 disabled:opacity-50"
          >
            <Users className="h-4 w-4" />
            {loading ? "Saliendo..." : "Sí, salir de todas"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={loading}
            className="inline-flex items-center rounded-lg bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label="Salir de todas las cuentas"
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)]/10",
        agrupado ? "shadow-[inset_0_-1px_0_0_var(--border)]" : "rounded-xl bg-[color:var(--sidebar-bg)]",
      )}
    >
      <Users className="h-4 w-4 shrink-0" />
      Salir de todas las cuentas ({cuentas.length})
    </button>
  );
}
