export default function TarjetaLoading() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 animate-pulse" aria-busy="true" aria-label="Cargando tarjeta">
      <div className="mb-4 h-5 w-24 rounded-md bg-[color:var(--sidebar-bg)]" />
      <div className="h-52 rounded-[22px] bg-[color:var(--sidebar-bg)]" />
      <div className="mt-4 h-24 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)]" />
      <div className="mt-4 h-48 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)]" />
    </div>
  );
}
