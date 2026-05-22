"use client";

import { useState } from "react";
import { createCoupon } from "../actions";

export function CouponForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);
    const result = await createCoupon(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="codigo" className="text-sm font-medium">
          Código del cupón
        </label>
        <input
          id="codigo"
          name="codigo"
          type="text"
          required
          minLength={3}
          maxLength={20}
          placeholder="DESCUENTO10"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="tipo_descuento" className="text-sm font-medium">
            Tipo
          </label>
          <select
            id="tipo_descuento"
            name="tipo_descuento"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="porcentaje">Porcentaje (%)</option>
            <option value="monto_fijo">Monto fijo ($)</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="valor" className="text-sm font-medium">
            Valor
          </label>
          <input
            id="valor"
            name="valor"
            type="number"
            required
            min={1}
            step="0.01"
            placeholder="15"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="fecha_expiracion" className="text-sm font-medium">
            Fecha de expiración{" "}
            <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="fecha_expiracion"
            name="fecha_expiracion"
            type="date"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="usos_maximos" className="text-sm font-medium">
            Usos máximos{" "}
            <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="usos_maximos"
            name="usos_maximos"
            type="number"
            min={1}
            placeholder="Sin límite"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Creando..." : "Crear cupón"}
      </button>
    </form>
  );
}
