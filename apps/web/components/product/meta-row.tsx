"use client";

import type { ReactNode } from "react";

interface MetaRowProps {
  categoria: string;
  // MP#08 #4 Fase 1A: nombre display de la primary del pivote, derivado en
  // el caller via primaryCategoryFull. Cuando llega, lo usamos directo (es
  // display-ready). Cuando no llega (call sites no migrados aun, edge sin
  // pivote), fallback al pretty-print de `categoria` TEXT (legacy path,
  // sobrevive hasta que #4 Fase 2 dropee la columna).
  categoryName?: string | null;
  ubicacion: string | null;
}

// Aqui vivia una distancia «a X km» calculada en el cliente: un
// getCurrentPosition AL MONTAR la ficha contra las coordenadas del vendedor.
// Nunca se ejecuto (la ficha no selecciona ubicacion_lat/lng y llegaban en
// null), pero era una trampa: con esas columnas en el select se habria pedido
// el permiso al abrir cualquier ficha (PDF 04: pedirlo solo al usar la
// funcion) y la coordenada de un tercero habria viajado al navegador (PDF 05).
// Si algun dia se quiere la distancia, que la calcule el servidor en cubos de
// 100 m, como «Cerca de ti».

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function shortUbicacion(ubicacion: string | null): string | null {
  if (!ubicacion) return null;
  const parts = ubicacion
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[1] ?? parts[0] ?? ubicacion;
}

export function MetaRow({
  categoria,
  categoryName,
  ubicacion,
}: MetaRowProps) {
  const ubic = shortUbicacion(ubicacion);

  const items: ReactNode[] = [];
  if (ubic) items.push(ubic);
  // MP#08 #4 Fase 1A: categoryName de pivote si llega, fallback al pretty
  // print del slug TEXT legacy. Cuando la columna se dropee (Fase 2), todos
  // los callers ya envian categoryName y este fallback queda inalcanzable.
  items.push(categoryName ?? capitalizeFirst(categoria.replace(/-/g, " ")));

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
      {items.map((item, i) => (
        <span
          key={`meta-${i}`}
          className="inline-flex items-center gap-1.5"
        >
          {i > 0 ? (
            <span aria-hidden className="text-fg-dim">
              ·
            </span>
          ) : null}
          {item}
        </span>
      ))}
    </div>
  );
}
