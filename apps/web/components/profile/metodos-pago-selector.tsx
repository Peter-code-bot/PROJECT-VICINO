"use client";

import { useState } from "react";
import { ChevronDown, CheckCircle2 } from "lucide-react";

export const METODOS_PAGO = [
  "Efectivo",
  "Tarjeta de crédito",
  "Tarjeta de débito",
  "Transferencia bancaria",
  "Mercado Pago",
  "OXXO Pay",
  "PayPal",
  "Depósito bancario",
  "Crypto",
];

interface MetodosPagoSelectorProps {
  metodosSeleccionados: string[];
  onChange: (metodos: string[]) => void;
}

export function MetodosPagoSelector({
  metodosSeleccionados,
  onChange,
}: MetodosPagoSelectorProps) {
  const [metodosOpen, setMetodosOpen] = useState(false);

  function toggleMetodo(metodo: string) {
    if (metodosSeleccionados.includes(metodo)) {
      onChange(metodosSeleccionados.filter((m) => m !== metodo));
    } else {
      onChange([...metodosSeleccionados, metodo]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMetodosOpen(!metodosOpen)}
        className="w-full flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-base text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span
          className={
            metodosSeleccionados.length > 0
              ? "text-foreground truncate pr-2"
              : "text-muted-foreground"
          }
        >
          {metodosSeleccionados.length > 0
            ? metodosSeleccionados.join(", ")
            : "Selecciona métodos de pago..."}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            metodosOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-all duration-300 ${
          metodosOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="rounded-xl bg-muted mt-1">
            <div className="p-2 space-y-0.5">
              {METODOS_PAGO.map((metodo) => (
                <label
                  key={metodo}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    metodosSeleccionados.includes(metodo)
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-foreground/5 text-foreground/80"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={metodosSeleccionados.includes(metodo)}
                    onChange={() => toggleMetodo(metodo)}
                  />
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      metodosSeleccionados.includes(metodo)
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {metodosSeleccionados.includes(metodo) && (
                      <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <span className="text-base">{metodo}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
