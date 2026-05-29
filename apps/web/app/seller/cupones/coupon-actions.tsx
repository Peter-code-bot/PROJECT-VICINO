"use client";

import { useState } from "react";
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
    await toggleCoupon(id, !activo);
    setLoading(false);
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este cupón?")) return;
    setLoading(true);
    await deleteCoupon(id);
    setLoading(false);
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
