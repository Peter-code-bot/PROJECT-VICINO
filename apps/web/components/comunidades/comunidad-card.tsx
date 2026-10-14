"use client";

import Link from "@/components/auth/auth-link";
import { Lock, Globe, Users, MessageSquare, MapPin, Crown, Shield } from "lucide-react";
import { formatRelativeTime, communityCategoryName } from "@vicino/shared";
import { cn } from "@/lib/utils";
import type { ComunidadResumen } from "@/lib/comunidades/tipos";
import type { GuestCommunityPreview } from "@/lib/home-guest-contract";
import { JoinButton, type EstadoRelacion } from "./join-button";
import { CommunityPhoto } from "./community-photo";

/** The guest DTO omits membership, roles and geographic distance. */
export type ComunidadCardPreview = GuestCommunityPreview & { es_privada: false };

interface ComunidadCardProps {
  comunidad: ComunidadResumen | ComunidadCardPreview;
  /** Muestra el boton de relacion (Descubrir). En "Mis comunidades" sobra. */
  conBoton?: boolean;
  vertical?: boolean;
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

export function ComunidadCard({ comunidad, conBoton = false, vertical = false, onEstado }: ComunidadCardProps) {
  const guestPreview = !("mi_rol" in comunidad);
  const distancia = "distancia_m" in comunidad ? comunidad.distancia_m : null;
  // mis_comunidades lista tambien las archivadas u ocultas donde sigo siendo
  // miembro (es la unica ruta para llegar y salir); descubrir no las trae.
  // Sigue gobernando lo que se puede hacer (y el atenuado de la tarjeta)
  // aunque ya no se pinte ninguna etiqueta: el dato no desaparece con ella.
  const disponible = "disponible" in comunidad ? comunidad.disponible : true;

  if (vertical) {
    const activity = comunidad.ultima_publicacion_at ? `Activa ${formatRelativeTime(comunidad.ultima_publicacion_at)}` : "Sin publicaciones";
    const category = communityCategoryName(comunidad.categoria_id);
    return (
      <article className={cn("overflow-hidden rounded-2xl product-card-custom", !disponible && "opacity-75")}>
        <Link href={`/comunidades/${comunidad.id}`} className="relative block" aria-label={`Ver ${comunidad.nombre}`}>
          <CommunityPhoto nombre={comunidad.nombre} url={comunidad.foto_url} />
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-card/95 px-1.5 py-1">
            <BadgeVisibilidad esPrivada={comunidad.es_privada} />
            {"mi_rol" in comunidad && <ChipRol rol={comunidad.mi_rol} />}
          </div>
          <span className="absolute bottom-0 left-3 max-w-[calc(100%-1.5rem)] translate-y-1/2 truncate rounded px-2 py-1 font-heading text-[9px] font-extrabold uppercase tracking-wide product-card-tab" title={category}>{category}</span>
        </Link>
        {/* Para ti's real ProductCard body measures 132.78 px. One fixed body
            keeps joins aligned while retaining all directory metadata. */}
        <div className="flex h-[133px] flex-col px-3 pb-2 pt-3">
          <Link href={`/comunidades/${comunidad.id}`} className="block h-9 shrink-0">
            <h3 className="line-clamp-2 font-heading text-[14px] font-bold leading-[18px] text-fg">{comunidad.nombre}</h3>
          </Link>
          <div className="mt-1 flex h-3.5 shrink-0 items-center gap-3 text-[10.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" />{comunidad.miembros_count} {comunidad.miembros_count === 1 ? "persona" : "personas"}</span>
            <span className="inline-flex items-center gap-1" aria-label={`${comunidad.publicaciones_count} publicaciones`}><MessageSquare className="h-3 w-3" aria-hidden="true" />{comunidad.publicaciones_count}</span>
          </div>
          <div className="mt-1 flex h-3.5 shrink-0 items-center gap-2 text-[10px] text-fg-muted">
            {distancia !== null && <span className="inline-flex shrink-0 items-center gap-0.5"><MapPin className="h-3 w-3" aria-hidden="true" />{formatoDistancia(distancia)}</span>}
            <span className="min-w-0 truncate" title={activity}>{activity}</span>
          </div>
          <div className="mt-auto flex h-8 shrink-0 justify-center">
            {conBoton && "soy_miembro" in comunidad && <JoinButton communityId={comunidad.id} nombre={comunidad.nombre} esPrivada={comunidad.es_privada} size="sm" estado={{ soy_miembro: comunidad.soy_miembro, mi_rol: comunidad.mi_rol, solicitud_pendiente: comunidad.solicitud_pendiente, miembros_count: comunidad.miembros_count, puedo_entrar: comunidad.puedo_entrar }} onEstado={estado => onEstado?.(comunidad.id, estado)} />}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={cn("rounded-2xl bg-[color:var(--sidebar-bg)] p-4 transition-all hover:shadow-md", !disponible && "opacity-75")}>
      <div className={cn(vertical && "flex flex-1 flex-col p-3")}>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/comunidades/${comunidad.id}`} className={cn("min-w-0 flex-1", guestPreview && "min-h-12 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!")}>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <BadgeVisibilidad esPrivada={comunidad.es_privada} />
            {"mi_rol" in comunidad && <ChipRol rol={comunidad.mi_rol} />}
          </div>
          <h3 className={cn("font-heading font-bold leading-snug text-[color:var(--fg)] line-clamp-2", vertical ? "h-10 text-[14px]" : "text-[16px]")}>
            {comunidad.nombre}
          </h3>
          {(comunidad.descripcion || vertical) && (
            <p className={cn("mt-1 text-sm line-clamp-2", vertical && "h-10 text-xs", guestPreview ? "text-fg dark:text-fg-muted" : "text-[color:var(--fg-muted)]")}>{comunidad.descripcion}</p>
          )}
        </Link>
      </div>

      <div className={cn("mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", vertical && "min-h-16", guestPreview ? "text-fg dark:text-fg-muted" : "text-[color:var(--fg-muted)]")}>
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
          <span className={cn(vertical ? "w-full" : "ml-auto")}>Activa {formatRelativeTime(comunidad.ultima_publicacion_at)}</span>
        )}
      </div>

      {conBoton && "soy_miembro" in comunidad && (
        <div className={cn("mt-3 flex", vertical ? "min-h-9 justify-center" : "justify-end")}>
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
      </div>
    </article>
  );
}
