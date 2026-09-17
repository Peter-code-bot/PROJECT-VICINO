"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, Users, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import type { DetalleComunidad } from "@/lib/comunidades/tipos";
import { esMando } from "@/lib/comunidades/tipos";
import { BadgeVisibilidad, ChipRol } from "./comunidad-card";
import { JoinButton, type EstadoRelacion } from "./join-button";
import { ComunidadMiembrosDrawer, type SolicitudesIniciales } from "./comunidad-miembros-drawer";

interface DetalleCabeceraProps {
  detalle: DetalleComunidad;
  /**
   * Cola que el servidor ya leyo: llega null cuando no habia que pedirla (no
   * mandas, o la comunidad es publica). Viene del servidor para que el drawer
   * abra con las solicitudes ya puestas y no con un spinner.
   */
  solicitudes?: SolicitudesIniciales | null;
}

/**
 * Misma forma que el boton de volver. El after: esta porque un circulo de
 * 40 px no llega a los 44 px de area tactil, y agrandar el circulo
 * descuadraria los cuatro iconos de la fila.
 */
const BOTON_ICONO =
  "relative flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-[color:var(--border)]/20 after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

/** El lector de pantalla no ve la burbuja: el numero tiene que estar en el nombre. */
function etiquetaIntegrantes(pendientes: number, hayMas: boolean): string {
  if (pendientes === 0) return "Integrantes";
  if (pendientes === 1 && !hayMas) return "Integrantes y 1 solicitud pendiente";
  return `Integrantes y ${pendientes}${hayMas ? " o más" : ""} solicitudes pendientes`;
}

/**
 * Cabecera de /comunidades/[id]: nombre (inmutable), descripcion, cuanta
 * gente, badge publica/privada y la triada de iconos (integrantes,
 * administrar, salir). No hay "Fundada por X" (decision 11).
 *
 * El boton grande de relacion queda para quien NO es miembro (entrar,
 * solicitar, solicitud enviada). Para quien ya lo es, salir vive en el icono
 * de la fila: el mismo JoinButton en variante "icono", para no reimplementar
 * la confirmacion ni el caso de la ultima persona.
 */
export function DetalleCabecera({ detalle, solicitudes = null }: DetalleCabeceraProps) {
  const router = useRouter();
  const [relacion, setRelacion] = useState<EstadoRelacion>({
    soy_miembro: detalle.soy_miembro,
    mi_rol: detalle.mi_rol,
    solicitud_pendiente: detalle.solicitud_pendiente,
    miembros_count: detalle.miembros_count,
    puedo_entrar: detalle.puedo_entrar,
  });
  const [miembrosAbierto, setMiembrosAbierto] = useState(false);

  const mando = esMando(relacion.mi_rol);
  const cola = mando ? solicitudes : null;
  const pendientes = cola?.items.length ?? 0;
  // La cola vino llena, asi que hay mas de las que se contaron: el numero de
  // la burbuja seria falso sin el "+".
  const hayMasPendientes = Boolean(cola?.cursor);

  return (
    <header className="px-4 pt-3 pb-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          className={BOTON_ICONO}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMiembrosAbierto(true)}
            aria-label={etiquetaIntegrantes(pendientes, hayMasPendientes)}
            className={BOTON_ICONO}
          >
            <Users className="h-5 w-5" aria-hidden="true" />
            {pendientes > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--brand)] px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--bg)]"
              >
                {pendientes}
                {hayMasPendientes ? "+" : ""}
              </span>
            )}
          </button>

          {mando && detalle.disponible && (
            <Link href={`/comunidades/${detalle.id}/administrar`} aria-label="Administrar" className={BOTON_ICONO}>
              <Settings className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}

          {relacion.soy_miembro && (
            <JoinButton
              communityId={detalle.id}
              nombre={detalle.nombre}
              esPrivada={detalle.es_privada}
              estado={relacion}
              variante="icono"
              // Salir cambia lo que se ve del muro; la accion hace
              // revalidatePath de esta ruta y Next vuelve a pedir el RSC solo.
              onEstado={setRelacion}
            />
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <BadgeVisibilidad esPrivada={detalle.es_privada} />
        <ChipRol rol={relacion.mi_rol} />
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
          <Users className="h-4 w-4" aria-hidden="true" />
          {relacion.miembros_count} {relacion.miembros_count === 1 ? "persona" : "personas"}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {detalle.publicaciones_count} {detalle.publicaciones_count === 1 ? "publicación" : "publicaciones"}
        </span>
        {detalle.ultima_publicacion_at && <span>Activa {formatRelativeTime(detalle.ultima_publicacion_at)}</span>}
      </div>

      {!relacion.soy_miembro && detalle.disponible && (
        <div className="mt-4">
          <JoinButton
            communityId={detalle.id}
            nombre={detalle.nombre}
            esPrivada={detalle.es_privada}
            estado={relacion}
            // Entrar cambia lo que se ve del muro; la accion hace
            // revalidatePath de esta ruta y Next vuelve a pedir el RSC solo.
            onEstado={setRelacion}
          />
        </div>
      )}

      {miembrosAbierto && (
        <ComunidadMiembrosDrawer
          communityId={detalle.id}
          nombre={detalle.nombre}
          mando={mando}
          miembrosCount={relacion.miembros_count}
          solicitudes={cola}
          onClose={() => setMiembrosAbierto(false)}
        />
      )}
    </header>
  );
}
