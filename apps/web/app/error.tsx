"use client";

export default function ErrorDePagina({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-12 text-fg">
      <h1 className="font-heading text-xl font-semibold">No pudimos cargar esta página</h1>
      <p role="status" className="mt-3 text-muted-foreground">Comprueba tu conexión e intenta de nuevo.</p>
      <button type="button" onClick={unstable_retry} className="mt-6 min-h-12 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        Reintentar
      </button>
    </main>
  );
}
