"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLogout } from "@/hooks/use-logout";
import { useCuentas } from "@/lib/cuentas/use-cuentas";
import { nombreVisible } from "@/lib/cuentas/cambio";
import { LogOut, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `agrupado`: fila dentro del grupo de "Sesion" de /configuracion (mismo
 * estilo que las filas de "Cuenta", con divisor abajo) en vez de boton suelto.
 *
 * `userId`: la cuenta con sesion. Con otras cuentas guardadas en el telefono,
 * "Cerrar sesion" pasa a la mas reciente (decision D3), y el dialogo tiene que
 * decirlo: prometer "tendras que volver a iniciar sesion" y dejar abierta la
 * cuenta del negocio es justo lo contrario de lo que alguien espera al prestar
 * el telefono. Por eso aqui tambien esta "Salir de todas las cuentas".
 */
export function LogoutSection({ agrupado = false, userId }: { agrupado?: boolean; userId?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState<"una" | "todas" | null>(null);
  const logout = useLogout();
  const cuentas = useCuentas();
  const siguiente = cuentas.find((c) => c.userId !== userId) ?? null;

  async function handleConfirm(todas: boolean) {
    setLoading(todas ? "todas" : "una");
    const result = await logout({ todas });
    if (result.error) {
      toast.error(result.error);
      setLoading(null);
    }
  }

  if (confirming) {
    return (
      <div className={cn("rounded-xl bg-[rgba(255,59,48,0.08)] p-4 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]", agrupado && "m-2")}>
        <p className="mb-1 text-sm font-semibold text-[color:var(--fg)]">
          ¿Cerrar sesión?
        </p>
        <p className="mb-4 text-xs text-[color:var(--fg-muted)]">
          {siguiente
            ? `Saldrás de esta cuenta y pasarás a ${nombreVisible(siguiente)}, que sigue guardada en este teléfono.`
            : "Tendrás que volver a iniciar sesión la próxima vez."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleConfirm(false)}
            disabled={loading !== null}
            aria-label="Confirmar cierre de sesión"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-95 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {loading === "una" ? "Cerrando..." : siguiente ? `Sí, pasar a ${nombreVisible(siguiente)}` : "Sí, cerrar sesión"}
          </button>
          {siguiente && (
            <button
              onClick={() => void handleConfirm(true)}
              disabled={loading !== null}
              aria-label="Salir de todas las cuentas"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.45)] transition-colors hover:bg-[rgba(255,59,48,0.08)] disabled:opacity-50"
            >
              <Users className="h-4 w-4" />
              {loading === "todas" ? "Saliendo..." : "Salir de todas las cuentas"}
            </button>
          )}
          <button
            onClick={() => setConfirming(false)}
            disabled={loading !== null}
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
