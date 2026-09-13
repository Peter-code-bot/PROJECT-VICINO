import { Lock } from "lucide-react";

/**
 * Silueta del muro de una comunidad privada ajena (decision 3): bloques con
 * la forma de publicaciones, difuminados, sin UNA sola letra legible. No hay
 * texto detras del blur a proposito: no hay nada que descifrar ampliando la
 * pantalla. El unico contenido real es el aviso de encima.
 */
export function MuroDifuminado({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden="true" className="select-none space-y-3 blur-[6px] opacity-70" style={{ pointerEvents: "none" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[color:var(--fg)]/15" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-[color:var(--fg)]/20" />
                <div className="h-2.5 w-1/5 rounded bg-[color:var(--fg)]/10" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-3 w-full rounded bg-[color:var(--fg)]/15" />
              <div className={`h-3 rounded bg-[color:var(--fg)]/15 ${i % 2 === 0 ? "w-11/12" : "w-3/4"}`} />
              <div className={`h-3 rounded bg-[color:var(--fg)]/15 ${i % 3 === 0 ? "w-1/2" : "w-2/3"}`} />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-8 w-14 rounded-full bg-[color:var(--fg)]/10" />
              <div className="h-8 w-14 rounded-full bg-[color:var(--fg)]/10" />
            </div>
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex items-start justify-center pt-16">
        <div className="mx-4 max-w-sm rounded-3xl bg-[color:var(--card)] p-6 text-center shadow-[var(--shadow-lg),inset_0_0_0_1px_var(--border)]">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--fg)] text-[color:var(--bg)]">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="font-heading text-lg font-bold text-[color:var(--fg)]">Comunidad privada</h3>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--fg-muted)]">
            El muro solo lo ven sus miembros. Pide unirte y quien la administra revisará tu solicitud.
          </p>
          {children && <div className="mt-4 flex justify-center">{children}</div>}
        </div>
      </div>
    </div>
  );
}
