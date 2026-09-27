"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLogout } from "@/hooks/use-logout";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `agrupado`: fila dentro del grupo de "Sesion" de /configuracion (mismo
 * estilo que las filas de "Cuenta", con divisor abajo) en vez de boton suelto.
 */
export function LogoutSection({ agrupado = false }: { agrupado?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const logout = useLogout();

  async function handleConfirm() {
    setLoading(true);
    const result = await logout();
    if (result.error) {
      toast.error(result.error);
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className={cn("rounded-xl bg-[rgba(255,59,48,0.08)] p-4 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]", agrupado && "m-2")}>
        <p className="mb-1 text-sm font-semibold text-[color:var(--fg)]">
          ¿Cerrar sesión?
        </p>
        <p className="mb-4 text-xs text-[color:var(--fg-muted)]">
          Tendrás que volver a iniciar sesión la próxima vez.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={loading}
            aria-label="Confirmar cierre de sesión"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-95 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {loading ? "Cerrando..." : "Sí, cerrar sesión"}
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
      aria-label="Cerrar sesión"
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)]/10",
        agrupado ? "shadow-[inset_0_-1px_0_0_var(--border)]" : "rounded-xl bg-[color:var(--sidebar-bg)]",
      )}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      Cerrar sesión
    </button>
  );
}
