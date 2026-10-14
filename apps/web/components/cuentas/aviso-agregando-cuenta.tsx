"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { DESTINO_TRAS_AGREGAR, limpiarAgregandoCuenta } from "@/lib/cuentas/agregando-cuenta";
import { pedirRegistroPush } from "@/lib/push/registro";

/**
 * Encima del formulario de /login y /register cuando se llega con ?agregar=1:
 * la persona YA tiene sesion y esta agregando otra cuenta. Sin este aviso, ver
 * la pantalla de entrada con sesion abierta se lee como "me cerro la sesion".
 */
export function AvisoAgregandoCuenta() {
  const router = useRouter();
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl bg-[color:var(--brand-tint)] p-3 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
    >
      <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Estás agregando otra cuenta.</p>
        <p className="text-xs text-muted-foreground">La actual sigue guardada en este teléfono.</p>
      </div>
      <button
        type="button"
        onClick={() => {
          limpiarAgregandoCuenta();
          // Al salir hacia aqui se solto el token de push de la cuenta actual
          // (el token es del telefono); al cancelar hay que volver a pedirlo.
          pedirRegistroPush();
          router.push(DESTINO_TRAS_AGREGAR);
        }}
        className="shrink-0 text-xs font-semibold text-[color:var(--brand)] underline-offset-2 hover:underline"
      >
        Cancelar
      </button>
    </div>
  );
}
