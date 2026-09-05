/**
 * Esqueletos con la forma de cada pantalla, para los loading.tsx.
 *
 * Por que existen: hasta ahora la app no tenia NI UN loading.tsx. Sin ese
 * fichero, App Router no crea limite de Suspense en la ruta y el navegador se
 * queda en la pantalla ANTERIOR, sin mover un pixel, hasta que el servidor
 * termina de renderizar. Con /perfil -> /seller en nueve viajes de red en
 * serie, eso son cientos de milisegundos en los que tocar el boton no produce
 * ningun efecto visible y parece que la app se colgo.
 *
 * Se reutiliza la clase .skeleton de globals.css (shimmer), la misma que ya
 * usaba SkeletonCard, para que estos no desentonen con los que ya habia.
 *
 * Todos llevan role="status" y un texto solo para lectores de pantalla: un
 * bloque que parpadea no comunica nada a quien no lo ve.
 */

import { SkeletonGrid } from "@/components/shared/skeleton-card";

function Envoltorio({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Filas de texto de ancho decreciente, como un parrafo real. */
export function SkeletonLineas({ n = 3 }: { n?: number }) {
  const anchos = ["w-full", "w-11/12", "w-2/3", "w-3/4", "w-1/2"];
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`h-3 skeleton rounded-md ${anchos[i % anchos.length]}`} />
      ))}
    </div>
  );
}

/** Cabecera de perfil: avatar, nombre, fila de stats, chips y botones. */
export function SkeletonPerfil() {
  return (
    <Envoltorio etiqueta="Cargando el perfil">
      <div className="space-y-5 mb-6 px-4 pt-4">
        <div className="flex items-start gap-5">
          <div className="h-20 w-20 shrink-0 rounded-full skeleton" />
          <div className="flex-1 min-w-0 space-y-3">
            <div className="h-6 w-40 skeleton rounded-md" />
            <div className="h-3 w-24 skeleton rounded-md" />
            <div className="flex gap-6 pt-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div className="h-4 w-7 skeleton rounded-md" />
                  <div className="h-2 w-12 skeleton rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <SkeletonLineas n={2} />
        <div className="h-1.5 w-full skeleton rounded-full" />
        <div className="flex flex-wrap gap-2">
          {["w-28", "w-24", "w-20"].map((w, i) => (
            <div key={i} className={`h-7 ${w} skeleton rounded-full`} />
          ))}
        </div>
        <div className="flex gap-2">
          <div className="h-11 flex-1 skeleton rounded-xl" />
          <div className="h-11 w-32 skeleton rounded-xl" />
        </div>
      </div>
    </Envoltorio>
  );
}

/** Lista vertical de filas con avatar + dos lineas. Chat, historial, citas. */
export function SkeletonLista({ n = 6, etiqueta = "Cargando" }: { n?: number; etiqueta?: string }) {
  return (
    <Envoltorio etiqueta={etiqueta}>
      <div className="space-y-3 px-4 pt-4">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-3">
            <div className="h-12 w-12 shrink-0 rounded-full skeleton" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-3.5 w-1/3 skeleton rounded-md" />
              <div className="h-3 w-2/3 skeleton rounded-md" />
            </div>
            <div className="h-3 w-10 shrink-0 skeleton rounded-md" />
          </div>
        ))}
      </div>
    </Envoltorio>
  );
}

/** Formulario: filas de etiqueta + campo. Editar perfil, configuracion. */
export function SkeletonFormulario({ n = 6, etiqueta = "Cargando el formulario" }: { n?: number; etiqueta?: string }) {
  return (
    <Envoltorio etiqueta={etiqueta}>
      <div className="space-y-5 px-4 pt-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full skeleton" />
          <div className="h-4 w-32 skeleton rounded-md" />
        </div>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-2.5 w-24 skeleton rounded-md" />
            <div className="h-11 w-full skeleton rounded-xl" />
          </div>
        ))}
        <div className="h-11 w-full skeleton rounded-xl" />
      </div>
    </Envoltorio>
  );
}

/** Panel con tarjetas de metricas arriba y una lista debajo. Mi tienda. */
export function SkeletonPanel({ etiqueta = "Cargando" }: { etiqueta?: string }) {
  return (
    <Envoltorio etiqueta={etiqueta}>
      <div className="space-y-5 px-4 pt-4">
        <div className="h-6 w-36 skeleton rounded-md" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border/40 bg-card p-4">
              <div className="h-2.5 w-16 skeleton rounded-md" />
              <div className="h-6 w-12 skeleton rounded-md" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 w-full skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    </Envoltorio>
  );
}

/** Ficha de producto: imagen grande, precio, titulo, vendedor. */
export function SkeletonFicha() {
  return (
    <Envoltorio etiqueta="Cargando la publicacion">
      <div className="space-y-4">
        <div className="aspect-square w-full skeleton" />
        <div className="space-y-3 px-4">
          <div className="h-7 w-32 skeleton rounded-md" />
          <div className="h-5 w-3/4 skeleton rounded-md" />
          <SkeletonLineas n={3} />
          <div className="flex items-center gap-3 pt-2">
            <div className="h-12 w-12 rounded-full skeleton" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 skeleton rounded-md" />
              <div className="h-3 w-1/4 skeleton rounded-md" />
            </div>
          </div>
          <div className="h-12 w-full skeleton rounded-xl" />
        </div>
      </div>
    </Envoltorio>
  );
}

/** Rejilla de tarjetas, reutilizando la que ya existia. Feed, favoritos, buscar. */
export function SkeletonRejilla({ n = 8, etiqueta = "Cargando publicaciones" }: { n?: number; etiqueta?: string }) {
  return (
    <Envoltorio etiqueta={etiqueta}>
      <div className="px-4 pt-4">
        <SkeletonGrid count={n} />
      </div>
    </Envoltorio>
  );
}
