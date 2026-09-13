import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";

/**
 * Estado honesto para /comunidades/[id] cuando detalle_comunidad devuelve
 * cero filas: no existe, esta archivada u oculta, esta a mas de 5 km, o hay
 * bloqueo. La RPC no distingue a proposito (no es un oraculo de ids), asi
 * que aqui tampoco se inventa un motivo.
 */
export function ComunidadNoDisponible({ titulo = "Esta comunidad no está disponible" }: { titulo?: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto max-w-sm">
        <div className="relative mx-auto mb-6 h-24 w-24">
          <div className="absolute inset-0 rotate-6 rounded-3xl bg-muted" />
          <div className="absolute inset-0 -rotate-3 rounded-3xl bg-muted" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-foreground text-background">
            <MapPinOff className="h-10 w-10" />
          </div>
        </div>
        <h1 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">{titulo}</h1>
        <p className="mb-6 text-sm leading-relaxed text-[color:var(--fg-muted)]">
          Puede que ya no exista, que quede lejos de tu zona o que el enlace esté mal.
        </p>
        <Link
          href="/?feed=comunidades&tab=descubrir"
          className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3 font-semibold text-white shadow-[var(--shadow-glow)] transition-all duration-200 hover:bg-[color:var(--brand-dark)] active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Ver comunidades cerca
        </Link>
      </div>
    </div>
  );
}
