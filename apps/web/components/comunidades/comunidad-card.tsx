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
  // Publica: solo el mundo, sin chip ni borde. El sr-only NO es adorno: sin
  // el, quitar el texto visible deja al lector de pantalla sin saber que la
  // comunidad es publica, que es justo lo que el icono comunica a la vista.
  if (!esPrivada) {
    return (
      <span className={cn("inline-flex items-center text-black dark:text-white", className)}>
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Pública</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-[color:var(--fg)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--bg)]",
        className,
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Privada
    </span>
  );
}

export function ChipRol({ rol }: { rol: string | null }) {
  if (rol !== "owner" && rol !== "moderator") return null;
  const Icon = rol === "owner" ? Crown : Shield;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--card-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--fg-muted)]">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {rol === "owner" ? "admin" : "mod"}
    </span>
  );
}

export function ComunidadCard({ comunidad, conBoton = false, onEstado }: ComunidadCardProps) {
  const distancia = "distancia_m" in comunidad ? comunidad.distancia_m : null;
  // mis_comunidades lista tambien las archivadas u ocultas donde sigo siendo
  // miembro (es la unica ruta para llegar y salir); descubrir no las trae.
  // Sigue gobernando lo que se puede hacer (y el atenuado de la tarjeta)
  // aunque ya no se pinte ninguna etiqueta: el dato no desaparece con ella.
  const disponible = "disponible" in comunidad ? comunidad.disponible : true;

  return (
    <article className={cn("rounded-2xl bg-[color:var(--sidebar-bg)] p-4 transition-all hover:shadow-md", !disponible && "opacity-75")}>
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
              puedo_entrar: comunidad.puedo_entrar,
            }}
            onEstado={(estado) => onEstado?.(comunidad.id, estado)}
          />
        </div>
      )}
    </article>
  );
}
