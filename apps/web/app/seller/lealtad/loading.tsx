export default function LealtadLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Cargando tarjeta de lealtad">
      <div className="h-7 w-48 rounded-md bg-[color:var(--sidebar-bg)]" />
      <div className="h-44 max-w-[320px] rounded-[22px] bg-[color:var(--sidebar-bg)]" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[110px] rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)]" />
        ))}
      </div>
      <div className="h-32 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)]" />
    </div>
  );
}
