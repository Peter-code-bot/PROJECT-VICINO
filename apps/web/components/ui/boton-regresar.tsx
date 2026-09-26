"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Familia "Regreso" del brand book (BB03, aprobada por Pedro el 26-sep-2026).
 *
 * Este componente es SOLO la apariencia. El destino lo decide cada flujo:
 * con `href` (un Link fijo) o con `onClick` (/vender usa el resolver seguro
 * S01, la ficha de producto su propio fallback, comunidades router.back()).
 * No se sustituye ninguno por un router.back() generico, porque cada flujo
 * tiene reglas de retorno distintas y algunas son de seguridad.
 *
 * Variantes:
 *  - "flotante": vidrio (el mismo material que la barra inferior). Es la
 *                apariencia aprobada; en la app iOS la ficha de producto la
 *                sustituye ademas por vidrio nativo.
 *  - "solido":   superficie elevada, para contextos donde el vidrio no se lee.
 *
 * Mide 44x44: es el minimo tactil de Apple; los regresos anteriores median
 * 32-40px.
 */
type Variante = "solido" | "flotante";

interface BotonRegresarProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variante?: Variante;
  /** Si se pasa, el regreso es un enlace fijo en vez de un boton. */
  href?: string;
  /** Nombre accesible. Obligatorio: el boton solo muestra un icono. */
  "aria-label": string;
}

export const BotonRegresar = forwardRef<HTMLButtonElement, BotonRegresarProps>(
  ({ variante = "flotante", href, className, type = "button", ...props }, ref) => {
    const clases = cn(
      "regresar inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
      variante === "flotante" ? "regresar-flotante" : "regresar-solido",
      className,
    );
    const icono = (
      <ChevronLeft aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={2.4} />
    );
    if (href) {
      return (
        <Link
          href={href}
          aria-label={props["aria-label"]}
          data-testid={(props as Record<string, unknown>)["data-testid"] as string | undefined}
          className={clases}
        >
          {icono}
        </Link>
      );
    }
    return (
      <button ref={ref} type={type} data-variante={variante} className={clases} {...props}>
        {icono}
      </button>
    );
  },
);
BotonRegresar.displayName = "BotonRegresar";
