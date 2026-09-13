"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HomeTabsFilaProps {
  /** Cambia cuando cambia el tab activo: dispara el desplazamiento. */
  activeId: string;
  children: ReactNode;
}

/**
 * La fila desplazable de los tabs del home (decision 2: overflow-x-auto,
 * los cuatro no caben en 375 px). Dos cosas que un contenedor con scroll no
 * hace solo:
 *
 * 1. Traer a la vista el tab activo. Al aterrizar en /?feed=comunidades
 *    (deep link de una notificacion, el boton de no-disponible.tsx, el back
 *    desde /comunidades/[id]) el cuarto tab empieza mas alla del borde
 *    derecho y la fila mostraba tres tabs apagados y ninguno encendido. Se
 *    desplaza SOLO la fila (scrollLeft), nunca la pagina: scrollIntoView
 *    con block:'nearest' puede mover el documento verticalmente.
 *
 * 2. Decir que hay mas a la derecha. Sin scrollbar (scrollbar-hide) nadie
 *    descubre el cuarto tab: mientras quede contenido fuera de la ventana,
 *    el borde derecho se funde con un degradado (mask-image).
 */
export function HomeTabsFila({ activeId, children }: HomeTabsFilaProps) {
  const filaRef = useRef<HTMLDivElement>(null);
  const [desbordaDerecha, setDesbordaDerecha] = useState(false);

  useEffect(() => {
    const fila = filaRef.current;
    if (!fila) return;

    const medir = () => {
      // Un margen de 2 px absorbe el redondeo de subpixeles al final del scroll.
      setDesbordaDerecha(fila.scrollWidth - fila.clientWidth - fila.scrollLeft > 2);
    };

    const activo = fila.querySelector<HTMLElement>('[aria-current="page"]');
    if (activo) {
      const margen = 16;
      const izquierda = activo.offsetLeft;
      const derecha = izquierda + activo.offsetWidth;
      if (derecha > fila.scrollLeft + fila.clientWidth) {
        fila.scrollLeft = derecha - fila.clientWidth + margen;
      } else if (izquierda < fila.scrollLeft) {
        fila.scrollLeft = Math.max(0, izquierda - margen);
      }
    }
    medir();

    fila.addEventListener("scroll", medir, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    observer?.observe(fila);
    return () => {
      fila.removeEventListener("scroll", medir);
      observer?.disconnect();
    };
  }, [activeId]);

  return (
    <div
      ref={filaRef}
      className={cn("-mx-0 overflow-x-auto scrollbar-hide px-4 pt-3 pb-1")}
      style={
        desbordaDerecha
          ? {
              maskImage: "linear-gradient(to right, black calc(100% - 40px), transparent)",
              WebkitMaskImage: "linear-gradient(to right, black calc(100% - 40px), transparent)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
