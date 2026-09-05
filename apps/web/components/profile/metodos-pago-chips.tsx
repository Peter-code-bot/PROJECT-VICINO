"use client";

import { useState } from "react";
import { parsePaymentMethods } from "@/lib/payment-methods";

/**
 * A partir de cuantos metodos compensa colapsar. Con uno o dos, esconderlos
 * cuesta un toque y no ahorra sitio: la fila cabe entera, asi que se pintan
 * todos. El selector ofrece nueve metodos (metodos-pago-selector.tsx), asi que
 * el caso de la lista larga es real, no teorico.
 */
const UMBRAL_COLAPSO = 3;

const CLASE_CHIP =
  "rounded-full px-2.5 py-1 text-xs font-semibold product-card-tab shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]";

interface MetodosPagoChipsProps {
  metodosPagoAceptados: string | null;
}

/**
 * Pinta los metodos de pago del vendedor como chips sueltos, pensados para
 * vivir dentro de una fila `flex-wrap` ya existente: por eso devuelve un
 * fragmento y no su propio contenedor.
 *
 * Usa parsePaymentMethods en vez de un `split(",")` a pelo porque la columna
 * es TEXT libre: sin el filtro, una cadena vacia o una coma de sobra pintaba
 * un chip en blanco.
 */
export function MetodosPagoChips({ metodosPagoAceptados }: MetodosPagoChipsProps) {
  const [expandido, setExpandido] = useState(false);
  const metodos = parsePaymentMethods(metodosPagoAceptados);

  if (metodos.length === 0) return null;

  const colapsado = metodos.length > UMBRAL_COLAPSO && !expandido;
  const visibles = colapsado ? metodos.slice(0, UMBRAL_COLAPSO) : metodos;
  const ocultos = metodos.length - visibles.length;

  return (
    <>
      {visibles.map((metodo) => (
        <span key={metodo} className={CLASE_CHIP}>
          {metodo}
        </span>
      ))}

      {metodos.length > UMBRAL_COLAPSO && (
        <button
          type="button"
          onClick={() => setExpandido(!expandido)}
          className={`${CLASE_CHIP} text-[color:var(--fg-muted)] transition-opacity hover:opacity-80`}
          aria-expanded={expandido}
        >
          {colapsado ? `+${ocultos}` : "Ver menos"}
        </button>
      )}
    </>
  );
}
