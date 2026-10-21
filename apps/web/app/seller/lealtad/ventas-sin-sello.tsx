"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@vicino/shared";
import { selloDesdeVenta } from "./actions";

interface VentaSinSello {
  sale_id: string;
  created_at: string;
  error: string | null;
}

interface VentasSinSelloProps {
  ventas: VentaSinSello[];
}

const MOTIVOS: Record<string, string> = {
  sin_programa_activo: "El programa no estaba activo en esa venta.",
  sin_membresia: "El cliente no tenía tarjeta cuando se completó la venta.",
  venta_no_completada: "La venta no está completada.",
};

/** Ventas completadas cuyo sello fallo en la base: el negocio lo repite aqui. */
export function VentasSinSello({ ventas }: VentasSinSelloProps) {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  function repetir(saleId: string) {
    setEnCurso(saleId);
    iniciar(async () => {
      const resultado = await selloDesdeVenta(saleId);
      setEnCurso(null);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(resultado.motivo ? (MOTIVOS[resultado.motivo] ?? "Revisado: no corresponde sello.") : "Sello registrado");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5">
      <div>
        <h2 className="font-heading text-base font-bold text-[color:var(--fg)] sm:text-lg">Ventas sin sello</h2>
        <p className="text-xs text-[color:var(--fg-muted)]">
          Estas ventas se completaron pero el sello no se registró. Vuelve a intentarlo; si no corresponde sello, la
          venta sale de la lista.
        </p>
      </div>
      <ul className="space-y-2">
        {ventas.map((v) => (
          <li key={v.sale_id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-[color:var(--fg)]">{v.sale_id}</p>
              <p className="truncate text-xs text-[color:var(--fg-muted)]">{formatDate(v.created_at)}</p>
            </div>
            <button
              type="button"
              onClick={() => repetir(v.sale_id)}
              disabled={enCurso !== null}
              className="shrink-0 rounded-[var(--r-pill)] bg-[color:var(--fg)] px-3 py-1.5 text-xs font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60"
            >
              {enCurso === v.sale_id ? "Registrando…" : "Registrar sello"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
