/**
 * Hueco con la forma de la tira de rankings del inicio.
 *
 * Marcado puro, sin "use client": lo usan el Suspense de page.tsx mientras
 * RankingsHomeStripSection consulta la base, y loading.tsx cuando el inicio
 * se pinta desde la memoria de sesion y la tira aun no ha llegado. Tiene la
 * misma altura que la tira real para que el feed no salte al sustituirlo.
 */
export function RankingSkeleton() {
  return (
    <div className="px-4 pb-6 mt-4 animate-pulse">
      <div className="h-[120px] w-full rounded-[20px] bg-[color:var(--card-2)] border" />
    </div>
  );
}
