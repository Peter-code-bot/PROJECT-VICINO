import Link from "next/link";
import { Stamp } from "lucide-react";
import type { ProgramaPublico } from "@/lib/lealtad/esquemas";
import { UnirmeBoton } from "./unirme-boton";

interface OfertaLealtadProps {
  programa: ProgramaPublico;
  sellerId: string;
  sesion: boolean;
  esDueno: boolean;
  membresia: { id: string; sellos_disponibles: number; status: "activa" | "revocada" } | null;
}

/**
 * Seccion del perfil publico: "Junta 5 sellos y recibe un cafe" + la accion
 * que toque (unirse, ver mi tarjeta, administrar). Sin sesion manda a login y
 * vuelve al mismo perfil.
 */
export function OfertaLealtad({ programa, sellerId, sesion, esDueno, membresia }: OfertaLealtadProps) {
  return (
    <section
      aria-label="Tarjeta de lealtad"
      className="mb-6 flex items-center gap-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4"
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: programa.color }}
        aria-hidden
      >
        <Stamp className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--fg-dim)]">Tarjeta de lealtad</p>
        <p className="font-semibold text-[color:var(--fg)]">
          Junta {programa.meta_sellos} sellos y recibe {programa.premio}
        </p>
        <p className="text-xs text-[color:var(--fg-muted)]">
          {membresia
            ? `Llevas ${membresia.sellos_disponibles} de ${programa.meta_sellos}.`
            : "Cada compra confirmada en VICINO suma un sello."}
        </p>
      </div>
      <div className="shrink-0">
        {esDueno ? (
          <Link href="/seller/lealtad" className={boton}>
            Administrar
          </Link>
        ) : membresia ? (
          <Link href={`/tarjetas/${membresia.id}`} className={boton}>
            Mi tarjeta
          </Link>
        ) : sesion ? (
          <UnirmeBoton programId={programa.id} />
        ) : (
          <Link href={`/login?next=${encodeURIComponent(`/vendedor/${sellerId}`)}`} className={boton}>
            Unirme
          </Link>
        )}
      </div>
    </section>
  );
}

const boton =
  "inline-flex items-center justify-center rounded-[var(--r-pill)] bg-[color:var(--fg)] px-3.5 py-2 text-xs font-semibold text-[color:var(--bg)] hover:opacity-90 whitespace-nowrap";
