export default function TarjetasLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 animate-pulse" aria-busy="true" aria-label="Cargando tarjetas">
      <div className="mb-6 h-8 w-40 rounded-md bg-[color:var(--sidebar-bg)]" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-44 rounded-[22px] bg-[color:var(--sidebar-bg)]" />
        ))}
      </div>
    </div>
  );
}
