"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X, Loader2, Crown, Shield, Users, RotateCcw } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/ui/user-avatar";
import { traducirErrorComunidad } from "@/lib/comunidades/errores";
import type { MiembroComunidad, SolicitudEnCola, CursorComunidad } from "@/lib/comunidades/tipos";
import { SolicitudesCola } from "./admin/solicitudes-cola";

/** Padron de una comunidad de barrio: 200 filas cubren el tope real de miembros. */
const LIMITE_PADRON = 200;

export interface SolicitudesIniciales {
  items: SolicitudEnCola[];
  cursor: CursorComunidad | null;
  error?: string;
}

interface ComunidadMiembrosDrawerProps {
  communityId: string;
  nombre: string;
  /** esMando(mi_rol): decide si se ve la cola y si el padron es legible. */
  mando: boolean;
  /** El conteo autoritativo de la cabecera; el padron leido puede ser mas corto. */
  miembrosCount: number;
  /** Cola que el servidor ya trajo; null cuando no habia que pedirla. */
  solicitudes: SolicitudesIniciales | null;
  onClose: () => void;
}

type EstadoPadron =
  | { fase: "cargando" }
  | { fase: "listo"; items: MiembroComunidad[] }
  | { fase: "error"; mensaje: string };

/** Fila cruda de community_members con el perfil embebido por la FK. */
interface FilaPadron {
  user_id: string;
  role: string;
  joined_at: string;
  profiles: { nombre: string; foto: string | null } | { nombre: string; foto: string | null }[] | null;
}

/**
 * PostgREST devuelve el embed como objeto o como array segun deduzca la
 * cardinalidad; el mismo normalizado que usa la pantalla de administrar.
 * Una fila sin perfil se descarta en vez de pintarse sin nombre.
 */
function normalizarPadron(filas: FilaPadron[]): MiembroComunidad[] {
  return filas.flatMap((f) => {
    const perfil = Array.isArray(f.profiles) ? f.profiles[0] : f.profiles;
    if (!perfil) return [];
    return [
      {
        user_id: f.user_id,
        role: f.role,
        joined_at: f.joined_at,
        nombre: perfil.nombre,
        foto: perfil.foto ?? null,
      },
    ];
  });
}

/**
 * Drawer de la cabecera: solicitudes arriba (solo si mandas) e integrantes
 * abajo. Misma forma que fundar-drawer (portal, bloqueo de scroll, Escape y
 * data-modal-open para el boton atras del APK).
 *
 * El padron se lee por REST, no por RPC, y la policy de community_members
 * ("la mia, o el padron si modero esa comunidad") decide cuanto vuelve: quien
 * manda recibe la lista entera y quien no, solo su propia fila. Por eso la
 * lista de un miembro normal viene con el aviso de que no la esta viendo
 * completa: un "no hay integrantes" ahi seria mentira.
 */
export function ComunidadMiembrosDrawer({
  communityId,
  nombre,
  mando,
  miembrosCount,
  solicitudes,
  onClose,
}: ComunidadMiembrosDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [padron, setPadron] = useState<EstadoPadron>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);

  useBodyScrollLock(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
    setMounted(true);
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { data, error } = await createClient()
          .from("community_members")
          .select("user_id, role, joined_at, profiles!community_members_user_id_fkey(nombre, foto)")
          .eq("community_id", communityId)
          .is("left_at", null)
          .order("joined_at", { ascending: true })
          .limit(LIMITE_PADRON);
        if (!vivo) return;
        if (error) {
          setPadron({ fase: "error", mensaje: traducirErrorComunidad(error) });
          return;
        }
        setPadron({ fase: "listo", items: normalizarPadron(data ?? []) });
      } catch {
        // Sin red la promesa revienta: el reintento es la unica salida, y sin
        // este brazo el drawer se quedaria girando para siempre.
        if (vivo) setPadron({ fase: "error", mensaje: "No se pudo cargar la lista. Revisa tu conexión." });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [communityId, intento]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onClose]);

  function reintentar() {
    setPadron({ fase: "cargando" });
    setIntento((n) => n + 1);
  }

  if (!mounted) return null;

  // Variable y no una condicion suelta en el JSX: asi tsc sabe que dentro del
  // bloque la cola no es null y no hay que repetir la comprobacion.
  const cola = mando ? solicitudes : null;
  const listos = padron.fase === "listo" ? padron.items : [];
  // Quien no manda solo recibe su propia fila (policy de community_members):
  // sin este aviso, una lista de una persona o un vacio se leen como "aqui no
  // hay nadie mas", que es falso. Se compara contra el conteo en vez de fiarse
  // del rol porque un admin de la plataforma SI recibe el padron entero sin
  // mandar en la comunidad, y a ese el aviso le mentiria.
  const notaPrivacidad =
    !mando && listos.length < miembrosCount
      ? "Por privacidad, solo quien administra esta comunidad ve la lista de integrantes."
      : null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" data-modal-open="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        // El nombre del dialogo dice QUE es, no solo de que comunidad: el h2
        // visible es el nombre y por si solo no orienta a quien no ve.
        aria-label={`Integrantes de ${nombre}`}
        className="relative flex h-[100dvh] w-full flex-col rounded-none border-t border-border/50 bg-card shadow-2xl animate-slide-up md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-3xl"
      >
        <div className="sticky top-0 z-10 shrink-0 rounded-none bg-card pt-2 pb-3 md:rounded-t-3xl">
          <div className="mx-auto mt-2 mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30 md:hidden" />
          <div className="flex items-center justify-between gap-3 px-5">
            <h2 className="min-w-0 flex-1 truncate font-heading text-lg font-bold text-foreground">{nombre}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/80"
            >
              <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {cola && (
            <section className="space-y-3" aria-labelledby="miembros-drawer-solicitudes">
              <div className="px-1">
                <h3
                  id="miembros-drawer-solicitudes"
                  className="font-heading text-[15px] font-bold text-[color:var(--fg)]"
                >
                  Solicitudes
                </h3>
                <p className="text-xs text-[color:var(--fg-muted)]">
                  Aceptar deja entrar a esa persona al muro de la comunidad.
                </p>
              </div>
              <SolicitudesCola
                communityId={communityId}
                iniciales={cola.items}
                cursor={cola.cursor}
                error={cola.error}
              />
            </section>
          )}

          <section className="space-y-3" aria-labelledby="miembros-drawer-integrantes">
            <div className="px-1">
              <h3
                id="miembros-drawer-integrantes"
                className="font-heading text-[15px] font-bold text-[color:var(--fg)]"
              >
                Integrantes
              </h3>
              <p className="text-xs text-[color:var(--fg-muted)]">
                {miembrosCount} {miembrosCount === 1 ? "persona" : "personas"} en la comunidad.
              </p>
            </div>

            {padron.fase === "cargando" && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[color:var(--fg-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span role="status">Cargando integrantes</span>
              </div>
            )}

            {padron.fase === "error" && (
              <div className="py-8 text-center">
                <p className="mb-3 text-sm text-[color:var(--fg-muted)]">{padron.mensaje}</p>
                <button
                  type="button"
                  onClick={reintentar}
                  className="mx-auto inline-flex h-9 items-center gap-2 rounded-full bg-[color:var(--card-2)] px-4 text-[13px] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-[color:var(--border)]/20"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reintentar
                </button>
              </div>
            )}

            {padron.fase === "listo" && listos.length === 0 && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
                  <Users className="h-6 w-6 text-[color:var(--fg-muted)]" aria-hidden="true" />
                </div>
                <p className="text-sm text-[color:var(--fg-muted)]">
                  {notaPrivacidad ?? "Aún no hay integrantes que mostrar."}
                </p>
              </div>
            )}

            {listos.length > 0 && (
              <ul className="divide-y divide-[color:var(--border)]/15 overflow-hidden rounded-2xl bg-[color:var(--sidebar-bg)]">
                {listos.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 p-3.5">
                    <Link href={`/vendedor/${m.user_id}`} className="shrink-0" onClick={onClose}>
                      <UserAvatar src={m.foto} name={m.nombre} size="md" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/vendedor/${m.user_id}`}
                          onClick={onClose}
                          className="truncate text-sm font-semibold text-[color:var(--fg)]"
                        >
                          {m.nombre}
                        </Link>
                        {m.role === "owner" && (
                          <Crown
                            className="h-3.5 w-3.5 shrink-0 text-[color:var(--gold,#D4A853)]"
                            aria-label="Administra"
                          />
                        )}
                        {m.role === "moderator" && (
                          <Shield className="h-3.5 w-3.5 shrink-0 text-[color:var(--brand-hi)]" aria-label="Modera" />
                        )}
                      </div>
                      <p className="text-[11px] text-[color:var(--fg-dim)]">Desde {formatRelativeTime(m.joined_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {notaPrivacidad !== null && listos.length > 0 && (
              <p className="px-1 text-xs text-[color:var(--fg-muted)]">{notaPrivacidad}</p>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
