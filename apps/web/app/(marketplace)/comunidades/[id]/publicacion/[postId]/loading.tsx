/** Esqueleto del hilo: cabecera, la publicacion y tres comentarios. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-lg pb-28">
      <span className="sr-only">Cargando la publicación</span>
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <div className="h-10 w-10 skeleton rounded-full" />
        <div className="space-y-1.5">
          <div className="h-2.5 w-16 skeleton rounded-md" />
          <div className="h-4 w-40 skeleton rounded-md" />
        </div>
      </div>
      <div className="mx-4 rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 skeleton rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 skeleton rounded-md" />
            <div className="h-2.5 w-1/5 skeleton rounded-md" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full skeleton rounded-md" />
          <div className="h-3 w-11/12 skeleton rounded-md" />
          <div className="h-3 w-2/3 skeleton rounded-md" />
        </div>
      </div>
      <div className="mt-4 space-y-3 px-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 skeleton rounded-full" />
            <div className="flex-1 rounded-2xl bg-[color:var(--sidebar-bg)] px-3.5 py-2.5">
              <div className="h-3 w-1/4 skeleton rounded-md" />
              <div className="mt-2 h-3 w-4/5 skeleton rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
