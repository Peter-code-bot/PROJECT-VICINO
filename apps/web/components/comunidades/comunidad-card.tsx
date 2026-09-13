"use client";

import Link from "next/link";
import { Lock, Globe, Users, MessageSquare, MapPin, Crown, Shield } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { cn } from "@/lib/utils";
import type { ComunidadResumen } from "@/lib/comunidades/tipos";
import { JoinButton, type EstadoRelacion } from "./join-button";

interface ComunidadCardProps {
  comunidad: ComunidadResumen;
  /** Muestra el boton de relacion (Descubrir). En "Mis comunidades" sobra. */
  conBoton?: boolean;
  onEstado?: (id: string, estado: EstadoRelacion) => void;
}

function formatoDistancia(metros: number): string {
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

export function BadgeVisibilidad({ esPrivada, className }: { esPrivada: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]",
        esPrivada
          ? "bg-[color:var(--fg)] text-[color:var(--bg)]"
          : "bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]",
        className,
      )}
    >
      {esPrivada ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
      {esPrivada ? "Privada" : "Pública"}
    </span>
  );
}

export function ChipRol({ rol }: { rol: string | null }) {
  if (rol !== "owner" && rol !== "moderator") return null;
  const Icon = rol === "owner" ? Crown : Shield;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--card-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
      <Icon className="h-3 w-3" />
      {rol === "owner" ? "Administras" : "Moderas"}
    </span>
  );
}

export function ComunidadCard({ comunidad, conBoton = false, onEstado }: ComunidadCardProps) {
  const distancia = "distancia_m" in comunidad ? comunidad.distancia_m : null;

  return (
    <article className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4 transition-all hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/comunidades/${comunidad.id}`} className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <BadgeVisibilidad esPrivada={comunidad.es_privada} />
            <ChipRol rol={comunidad.mi_rol} />
          </div>
          <h3 className="font-heading text-[16px] font-bold leading-snug text-[color:var(--fg)] line-clamp-2">
            {comunidad.nombre}
          </h3>
          {comunidad.descripcion && (
            <p className="mt-1 text-sm text-[color:var(--fg-muted)] line-clamp-2">{comunidad.descripcion}</p>
          )}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[color:var(--fg-muted)]">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {comunidad.miembros_count} {comunidad.miembros_count === 1 ? "persona" : "personas"}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          {comunidad.publicaciones_count}
        </span>
        {distancia !== null && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />A {formatoDistancia(distancia)}
          </span>
        )}
        {comunidad.ultima_publicacion_at && (
          <span className="ml-auto">Activa {formatRelativeTime(comunidad.ultima_publicacion_at)}</span>
        )}
      </div>

      {conBoton && (
        <div className="mt-3 flex justify-end">
          <JoinButton
            communityId={comunidad.id}
            nombre={comunidad.nombre}
            esPrivada={comunidad.es_privada}
            size="sm"
            estado={{
              soy_miembro: comunidad.soy_miembro,
              mi_rol: comunidad.mi_rol,
              solicitud_pendiente: comunidad.solicitud_pendiente,
              miembros_count: comunidad.miembros_count,
            }}
            onEstado={(estado) => onEstado?.(comunidad.id, estado)}
          />
        </div>
      )}
    </article>
  );
}
