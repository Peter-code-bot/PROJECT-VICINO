"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toggleCoupon, deleteCoupon } from "./actions";
import { Play, Pause, Trash2 } from "lucide-react";

interface CouponActionsProps {
  id: string;
  activo: boolean;
}

export function CouponActions({ id, activo }: CouponActionsProps) {
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      // El { error } de la accion NO se descarta: es dinero del vendedor. Si
      // la escritura falla (rate limit, sesion caida, RLS) y no avisamos, el
      // cupon sigue activo y el vendedor cree que lo apago.
      const res = await toggleCoupon(id, !activo);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(activo ? "Cupón desactivado" : "Cupón activado");
    } catch {
      // La promesa del Server Action rechaza si se cae la red. Sin este catch
      // el finally tampoco corria y el boton quedaba deshabilitado para siempre.
      toast.error("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este cupón?")) return;
    setLoading(true);
    try {
      const res = await deleteCoupon(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Cupón eliminado");
    } catch {
      toast.error("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 sm:gap-2">
      <button
        onClick={handleToggle}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] disabled:opacity-50 transition-colors"
        title={activo ? "Desactivar" : "Activar"}
      >
        {activo ? <Pause className="h-4 w-4 sm:hidden" /> : <Play className="h-4 w-4 sm:hidden" />}
        <span className="hidden sm:inline">{activo ? "Desactivar" : "Activar"}</span>
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--danger)] hover:text-[color:var(--danger)]/80 disabled:opacity-50 transition-colors"
        title="Eliminar"
      >
        <Trash2 className="h-4 w-4 sm:hidden" />
        <span className="hidden sm:inline">Eliminar</span>
      </button>
    </div>
  );
}
