"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Users, MessageSquare, Archive } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import type { DetalleComunidad } from "@/lib/comunidades/tipos";
import { esMando } from "@/lib/comunidades/tipos";
import { BadgeVisibilidad, ChipRol } from "./comunidad-card";
import { JoinButton, type EstadoRelacion } from "./join-button";

interface DetalleCabeceraProps {
  detalle: DetalleComunidad;
}

/**
 * Cabecera de /comunidades/[id]: nombre (inmutable), descripcion, cuanta
 * gente, badge publica/privada y el boton de relacion. Quien manda ve el
 * acceso a Administrar. No hay "Fundada por X" (decision 11).
 */
export function DetalleCabecera({ detalle }: DetalleCabeceraProps) {
  const router = useRouter();
  const [relacion, setRelacion] = useState<EstadoRelacion>({
    soy_miembro: detalle.soy_miembro,
    mi_rol: detalle.mi_rol,
    solicitud_pendiente: detalle.solicitud_pendiente,
    miembros_count: detalle.miembros_count,
  });

  return (
    <header className="px-4 pt-3 pb-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-[color:var(--border)]/20"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {esMando(relacion.mi_rol) && detalle.disponible && (
          <Link
            href={`/comunidades/${detalle.id}/administrar`}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[color:var(--card-2)] px-4 text-[13px] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-hi)]"
          >
            <Settings className="h-4 w-4" />
            Administrar
          </Link>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <BadgeVisibilidad esPrivada={detalle.es_privada} />
        <ChipRol rol={relacion.mi_rol} />
        {!detalle.disponible && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--card-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
            <Archive className="h-3 w-3" />
            Archivada
          </span>
        )}
      </div>

      <h1 className="font-heading text-[26px] font-bold leading-[1.15] tracking-tight text-[color:var(--fg)]">
        {detalle.nombre}
      </h1>
      {detalle.descripcion && (
        <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">
          {detalle.descripcion}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[color:var(--fg-muted)]">
        <span className="inline-flex items-center gap-1">
          <Users className="h-4 w-4" />
          {relacion.miembros_count} {relacion.miembros_count === 1 ? "persona" : "personas"}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {detalle.publicaciones_count} {detalle.publicaciones_count === 1 ? "publicación" : "publicaciones"}
        </span>
        {detalle.ultima_publicacion_at && <span>Activa {formatRelativeTime(detalle.ultima_publicacion_at)}</span>}
      </div>

      {(detalle.disponible || relacion.soy_miembro) && (
        <div className="mt-4">
          <JoinButton
            communityId={detalle.id}
            nombre={detalle.nombre}
            esPrivada={detalle.es_privada}
            estado={relacion}
            // Entrar o salir cambia lo que se ve del muro; la accion hace
            // revalidatePath de esta ruta y Next vuelve a pedir el RSC solo.
            onEstado={setRelacion}
          />
        </div>
      )}
    </header>
  );
}
