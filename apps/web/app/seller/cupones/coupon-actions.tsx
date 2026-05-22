"use client";

import { useState } from "react";
import { toggleCoupon, deleteCoupon } from "./actions";

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
    <div className="flex gap-2">
      <button
        onClick={handleToggle}
        disabled={loading}
        className="text-xs font-medium text-fg-muted hover:text-fg disabled:opacity-50 transition-colors"
      >
        {activo ? "Desactivar" : "Activar"}
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-xs font-medium text-danger hover:text-danger/80 disabled:opacity-50 transition-colors"
      >
        Eliminar
      </button>
    </div>
  );
}
