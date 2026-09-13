/**
 * Esqueleto de /comunidades/[id]: cabecera (badge, titulo, descripcion,
 * conteos, boton) y tres publicaciones. Sin este archivo App Router no crea
 * el limite de Suspense y tocar una comunidad no mueve un pixel hasta que
 * el servidor termina (leccion de loading-skeletons.tsx).
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-lg pb-28">
      <span className="sr-only">Cargando la comunidad</span>
      <div className="px-4 pt-3 pb-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-10 w-10 skeleton rounded-full" />
          <div className="h-10 w-32 skeleton rounded-full" />
        </div>
        <div className="mb-2 h-5 w-20 skeleton rounded-full" />
        <div className="h-8 w-3/4 skeleton rounded-md" />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full skeleton rounded-md" />
          <div className="h-3 w-2/3 skeleton rounded-md" />
        </div>
        <div className="mt-3 flex gap-3">
          <div className="h-4 w-24 skeleton rounded-md" />
          <div className="h-4 w-28 skeleton rounded-md" />
        </div>
        <div className="mt-4 h-10 w-28 skeleton rounded-full" />
      </div>
      <div className="space-y-3 px-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 skeleton rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 skeleton rounded-md" />
                <div className="h-2.5 w-1/5 skeleton rounded-md" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-3 w-full skeleton rounded-md" />
              <div className="h-3 w-5/6 skeleton rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
