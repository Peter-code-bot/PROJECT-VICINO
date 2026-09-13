"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Shield, ShieldOff, Crown, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { nombrarModerador, quitarModerador } from "@/app/(marketplace)/comunidades/actions";
import type { MiembroComunidad } from "@/lib/comunidades/tipos";

interface Props {
  communityId: string;
  miembros: MiembroComunidad[];
  /** Tope de moderadores; espejo de comunidades_limite('moderadores_por_comunidad'). */
  topeModeradores: number;
  error?: string;
}

/**
 * Padron de miembros vivos con nombrar / quitar moderador (decision 5: solo
 * el owner nombra). El conteo X/tope se pinta arriba y el boton de nombrar
 * se deshabilita al llegar al tope, antes de que la base diga 23514.
 */
export function ModeradoresPanel({ communityId, miembros: iniciales, topeModeradores, error }: Props) {
  const [miembros, setMiembros] = useState<MiembroComunidad[]>(iniciales);
  const [enCurso, setEnCurso] = useState<string | null>(null);

  const moderadores = miembros.filter((m) => m.role === "moderator").length;
  const topeAlcanzado = moderadores >= topeModeradores;

  async function alternar(m: MiembroComunidad) {
    if (enCurso || m.role === "owner") return;
    const nombrar = m.role !== "moderator";
    if (nombrar && topeAlcanzado) return;
    setEnCurso(m.user_id);
    const previo = miembros;
    setMiembros((prev) =>
      prev.map((x) => (x.user_id === m.user_id ? { ...x, role: nombrar ? "moderator" : "member" } : x)),
    );
    const r = nombrar
      ? await nombrarModerador({ community_id: communityId, user_id: m.user_id })
      : await quitarModerador({ community_id: communityId, user_id: m.user_id });
    setEnCurso(null);
    if ("error" in r) {
      setMiembros(previo);
      toast.error(r.error);
      return;
    }
    setMiembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, role: r.data.role } : x)));
    toast.success(nombrar ? `${m.nombre} ahora modera la comunidad` : `${m.nombre} ya no modera`);
  }

  if (error) return <p className="py-6 text-center text-sm text-[color:var(--fg-muted)]">{error}</p>;

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-[color:var(--fg-muted)]">
        {Number.isFinite(topeModeradores) ? `${moderadores}/${topeModeradores}` : moderadores} moderadores. Los moderadores aprueban solicitudes y pueden borrar publicaciones.
      </p>
      <ul className="divide-y divide-[color:var(--border)]/15 overflow-hidden rounded-2xl bg-[color:var(--sidebar-bg)]">
        {miembros.map((m) => {
          const esOwner = m.role === "owner";
          const esMod = m.role === "moderator";
          const bloqueado = esOwner || (!esMod && topeAlcanzado) || enCurso !== null;
          return (
            <li key={m.user_id} className="flex items-center gap-3 p-3.5">
              <Link href={`/vendedor/${m.user_id}`} className="shrink-0">
                <UserAvatar src={m.foto} name={m.nombre} size="md" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link href={`/vendedor/${m.user_id}`} className="truncate text-sm font-semibold text-[color:var(--fg)]">
                    {m.nombre}
                  </Link>
                  {esOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-[color:var(--gold,#D4A853)]" aria-label="Administra" />}
                  {esMod && <Shield className="h-3.5 w-3.5 shrink-0 text-[color:var(--brand-hi)]" aria-label="Modera" />}
                </div>
                <p className="text-[11px] text-[color:var(--fg-dim)]">Desde {formatRelativeTime(m.joined_at)}</p>
              </div>
              {!esOwner && (
                <button
                  type="button"
                  onClick={() => void alternar(m)}
                  disabled={bloqueado}
                  title={!esMod && topeAlcanzado ? `Ya hay ${topeModeradores} moderadores` : undefined}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors disabled:opacity-50",
                    esMod
                      ? "bg-[color:var(--card)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] hover:text-[color:var(--danger)]"
                      : "bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)] hover:bg-[color:var(--brand-tint-strong)]",
                  )}
                >
                  {enCurso === m.user_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : esMod ? (
                    <ShieldOff className="h-3.5 w-3.5" />
                  ) : (
                    <Shield className="h-3.5 w-3.5" />
                  )}
                  {esMod ? "Quitar" : "Nombrar"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
