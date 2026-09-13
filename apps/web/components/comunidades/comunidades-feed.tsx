"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, LocateFixed, Loader2, Plus, Users, MapPin, Sparkles } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { useGeolocation } from "@/hooks/useGeolocation";
import { cargarDescubrir, cancelarSolicitud } from "@/app/(marketplace)/comunidades/actions";
import { tiempoQueFalta } from "@/lib/comunidades/errores";
import { esFalloDeRed } from "@/lib/net/fallo-de-red";
import type {
  PostComunidad,
  ComunidadMia,
  ComunidadCercana,
  SolicitudMia,
  EstadoCuotaFundacion,
  CursorComunidad,
} from "@/lib/comunidades/tipos";
import { SubTabs, type SubTabComunidades } from "./sub-tabs";
import { MuroComunidad } from "./muro-comunidad";
import { ComunidadCard } from "./comunidad-card";
import { FundarDrawer } from "./fundar-drawer";
import type { EstadoRelacion } from "./join-button";
import { toast } from "sonner";

interface ComunidadesFeedProps {
  user: { id: string; nombre: string; foto: string | null } | null;
  userLat: number | null;
  userLng: number | null;
  initialTab: SubTabComunidades;
  muro: { posts: PostComunidad[]; cursor: CursorComunidad | null };
  mias: ComunidadMia[];
  misSolicitudes: SolicitudMia[];
  /** null = el servidor no tenia ubicacion; se intenta con la del cliente. */
  cercanas: ComunidadCercana[] | null;
  cuota: EstadoCuotaFundacion;
  errores?: { muro?: string; mias?: string; cercanas?: string };
}

/**
 * Cuarto feed del home (decision 1). Tres sub-pestanas en un selector
 * secundario (decision 9): Muro (unificado de mis comunidades), Mis
 * comunidades y Descubrir (por la ubicacion de la cookie / el hook).
 */
export function ComunidadesFeed({
  user,
  userLat,
  userLng,
  initialTab,
  muro,
  mias,
  misSolicitudes,
  cercanas: cercanasIniciales,
  cuota,
  errores,
}: ComunidadesFeedProps) {
  const [tab, setTab] = useState<SubTabComunidades>(initialTab);
  const [fundar, setFundar] = useState(false);
  const [cercanas, setCercanas] = useState<ComunidadCercana[] | null>(cercanasIniciales);
  const [errorCercanas, setErrorCercanas] = useState<string | null>(errores?.cercanas ?? null);
  const [solicitudes, setSolicitudes] = useState<SolicitudMia[]>(misSolicitudes);
  const { state: geo, request: pedirGeo } = useGeolocation();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el servidor manda cuando trae una copia fresca
    setSolicitudes(misSolicitudes);
  }, [misSolicitudes]);

  // La sub-pestana viaja en la URL para que un enlace o un refresh vuelvan
  // al mismo sitio, pero con replaceState: navegar con el router volveria a
  // pedir el RSC entero por cambiar de pestana.
  const cambiarTab = useCallback((siguiente: SubTabComunidades) => {
    setTab(siguiente);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("feed", "comunidades");
    if (siguiente === "muro") url.searchParams.delete("tab");
    else url.searchParams.set("tab", siguiente);
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  // Descubrir sin ubicacion en la cookie: se intenta con la del cliente
  // (cache local del hook), que es lo que hace el feed de solicitudes.
  const posicionCliente = geo.status === "success" ? geo.position : null;
  const lat = userLat ?? posicionCliente?.lat ?? null;
  const lng = userLng ?? posicionCliente?.lng ?? null;

  // "Cargando" se deriva: hay ubicacion y aun no hay lista ni error. Sin
  // estado propio, el efecto solo escribe desde el callback de la accion.
  const cargandoCercanas =
    tab === "descubrir" && cercanas === null && errorCercanas === null && lat !== null && lng !== null;

  useEffect(() => {
    if (tab !== "descubrir" || cercanas !== null || errorCercanas !== null || lat === null || lng === null || !user) return;
    let vivo = true;
    cargarDescubrir({ lat, lng }).then(
      (r) => {
        if (!vivo) return;
        if (r.error) setErrorCercanas(r.error);
        else setCercanas(r.items);
      },
      (err: unknown) => {
        // Sin este brazo, quedarse sin senal dejaba el spinner girando para
        // siempre: cargandoCercanas se deriva de que `cercanas` y
        // `errorCercanas` sigan en null, y la guarda del efecto impide
        // reintentar. Encima el rechazo salia a Sentry como bug.
        if (!vivo) return;
        setErrorCercanas(
          esFalloDeRed(err)
            ? "Sin conexion. Revisa tu red e intentalo de nuevo."
            : "No se pudieron cargar las comunidades cercanas.",
        );
      },
    );
    return () => {
      vivo = false;
    };
  }, [tab, cercanas, errorCercanas, lat, lng, user]);

  function actualizarRelacion(id: string, estado: EstadoRelacion) {
    setCercanas((prev) =>
      prev
        ? prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  soy_miembro: estado.soy_miembro,
                  mi_rol: estado.mi_rol ?? "",
                  solicitud_pendiente: estado.solicitud_pendiente,
                  miembros_count: estado.miembros_count,
                }
              : c,
          )
        : prev,
    );
  }

  async function cancelarMia(s: SolicitudMia) {
    const previo = solicitudes;
    setSolicitudes((prev) => prev.filter((x) => x.id !== s.id));
    let r: Awaited<ReturnType<typeof cancelarSolicitud>>;
    try {
      r = await cancelarSolicitud(s.id, s.community_id);
    } catch (err) {
      // El onClick la llama con `void`: sin este catch el fallo de red salia
      // como rechazo no capturado y la fila se quedaba borrada de la lista
      // aunque el servidor no se hubiera enterado.
      setSolicitudes(previo);
      toast.error(
        esFalloDeRed(err)
          ? "Sin conexion. No se cancelo la solicitud."
          : "No se pudo cancelar la solicitud.",
      );
      return;
    }
    if ("error" in r) {
      setSolicitudes(previo);
      toast.error(r.error);
      return;
    }
    toast.success("Solicitud cancelada");
    setCercanas((prev) =>
      prev ? prev.map((c) => (c.id === s.community_id ? { ...c, solicitud_pendiente: false } : c)) : prev,
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <div className="mx-auto max-w-sm">
          <div className="relative mx-auto mb-6 h-20 w-20">
            <div className="absolute inset-0 rotate-6 rounded-[20px] bg-[color:var(--brand-tint)]" />
            <div className="absolute inset-0 -rotate-3 rounded-[20px] bg-[color:var(--brand-tint)]" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[20px] bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
              <Users className="h-8 w-8" />
            </div>
          </div>
          <h3 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">Las comunidades de tu barrio</h3>
          <p className="mb-6 text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">
            Inicia sesión para ver lo que pasa cerca de ti, unirte a una comunidad o fundar la tuya.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/login?next=%2F%3Ffeed%3Dcomunidades"
              className="flex h-12 items-center justify-center rounded-xl bg-[color:var(--brand)] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register?next=%2F%3Ffeed%3Dcomunidades"
              className="flex h-12 items-center justify-center rounded-xl bg-[color:var(--card-2)] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pendientes = solicitudes.filter((s) => s.status === "pendiente");
  const sinNada = mias.length === 0 && (cercanas === null || cercanas.length === 0);
  const falta = tiempoQueFalta(cuota.siguiente_en);
  const fundarBloqueado = !cuota.puede_fundar && (cuota.siguiente_en === null || falta !== null);

  const botonFundar = (
    <button
      type="button"
      onClick={() => setFundar(true)}
      disabled={fundarBloqueado}
      title={fundarBloqueado ? cuota.motivo ?? undefined : undefined}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-[color:var(--brand)] px-5 text-[14px] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] active:scale-[0.97] disabled:opacity-60 disabled:shadow-none"
    >
      {fundarBloqueado ? <Clock className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      {fundarBloqueado ? (falta ? `Podrás fundar en ${falta}` : "No puedes fundar por ahora") : "Fundar comunidad"}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <div className="pt-1 pb-3">
        <SubTabs active={tab} onChange={cambiarTab} pendientes={pendientes.length} />
      </div>

      <div className="px-4">
        {tab === "muro" && (
          mias.length === 0 ? (
            <EstadoVacio
              icono={<Users className="h-7 w-7" />}
              titulo="Aún no perteneces a ninguna comunidad"
              texto="Cuando te unas a una, sus publicaciones aparecerán aquí, todas juntas."
            >
              <button
                type="button"
                onClick={() => cambiarTab("descubrir")}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[color:var(--fg)] px-5 text-[14px] font-semibold text-[color:var(--bg)] transition-all hover:opacity-90 active:scale-[0.97]"
              >
                Descubrir comunidades
                <ArrowRight className="h-4 w-4" />
              </button>
            </EstadoVacio>
          ) : errores?.muro ? (
            <p className="py-10 text-center text-sm text-[color:var(--fg-muted)]">{errores.muro}</p>
          ) : (
            <MuroComunidad
              communityId={null}
              initialPosts={muro.posts}
              initialCursor={muro.cursor}
              currentUser={user}
              puedoPublicar={false}
              vacio={{
                titulo: "Tus comunidades están calladas",
                texto: "Entra a una y publica lo primero.",
              }}
            />
          )
        )}

        {tab === "mias" && (
          <div className="space-y-5">
            {pendientes.length > 0 && (
              <section className="space-y-2">
                <h3 className="px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
                  Solicitudes pendientes
                </h3>
                <div className="divide-y divide-[color:var(--border)]/20 overflow-hidden rounded-2xl bg-[color:var(--sidebar-bg)]">
                  {pendientes.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link href={`/comunidades/${s.community_id}`} className="block truncate font-medium text-[color:var(--fg)]">
                          {s.community_nombre}
                        </Link>
                        <p className="text-xs text-[color:var(--fg-muted)]">Enviada {formatRelativeTime(s.created_at)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void cancelarMia(s)}
                        className="text-xs font-semibold text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
                      >
                        Cancelar
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {errores?.mias ? (
              <p className="py-10 text-center text-sm text-[color:var(--fg-muted)]">{errores.mias}</p>
            ) : mias.length === 0 ? (
              <EstadoVacio
                icono={<Users className="h-7 w-7" />}
                titulo="Todavía no estás en ninguna comunidad"
                texto={
                  sinNada
                    ? "Nadie ha fundado una por aquí. Puedes ser quien empiece."
                    : "Descubre las que ya existen cerca de ti o funda la tuya."
                }
              >
                {botonFundar}
              </EstadoVacio>
            ) : (
              <section className="space-y-3">
                {mias.map((c) => (
                  <ComunidadCard key={c.id} comunidad={c} />
                ))}
              </section>
            )}
          </div>
        )}

        {tab === "descubrir" && (
          <div className="space-y-3">
            {lat === null || lng === null ? (
              <EstadoVacio
                icono={<MapPin className="h-7 w-7" />}
                titulo="Activa tu ubicación"
                texto="Las comunidades se ordenan por cercanía. Solo usamos tu zona aproximada."
              >
                <button
                  type="button"
                  onClick={pedirGeo}
                  disabled={geo.status === "loading"}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[color:var(--fg)] px-5 text-[14px] font-semibold text-[color:var(--bg)] transition-all hover:opacity-90 disabled:opacity-60"
                >
                  {geo.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                  Usar mi ubicación
                </button>
                {geo.status === "error" && <p className="mt-2 text-xs text-destructive">{geo.message}</p>}
              </EstadoVacio>
            ) : cargandoCercanas ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 animate-pulse rounded-2xl bg-[color:var(--sidebar-bg)]" />
                ))}
              </div>
            ) : errorCercanas ? (
              <p className="py-10 text-center text-sm text-[color:var(--fg-muted)]">{errorCercanas}</p>
            ) : cercanas && cercanas.length === 0 ? (
              <EstadoVacio
                icono={<Sparkles className="h-7 w-7" />}
                titulo="Nadie ha fundado una comunidad por aquí"
                texto="Tu zona todavía no tiene ninguna. Sé quien funde la primera: la verán las personas a menos de 5 km."
              >
                {botonFundar}
              </EstadoVacio>
            ) : (
              <>
                {cercanas?.map((c) => (
                  <ComunidadCard key={c.id} comunidad={c} conBoton onEstado={actualizarRelacion} />
                ))}
                <p className="pt-2 text-center text-xs text-[color:var(--fg-dim)]">
                  Se muestran las comunidades a menos de 5 km de tu zona.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* FAB de fundar: mismo sitio y tamano que el de solicitudes. Con la cuota
          agotada se queda visible pero deshabilitado (decision 10). */}
      <button
        type="button"
        onClick={() => setFundar(true)}
        disabled={fundarBloqueado}
        aria-label={fundarBloqueado ? (falta ? `Podrás fundar en ${falta}` : "No puedes fundar por ahora") : "Fundar comunidad"}
        title={fundarBloqueado ? cuota.motivo ?? undefined : "Fundar comunidad"}
        className={cn(
          "fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-5 z-40 flex h-14 items-center justify-center gap-2 rounded-full bg-foreground text-background shadow-lg shadow-foreground/20 transition-transform hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-60",
          fundarBloqueado ? "px-4" : "w-14",
        )}
      >
        {fundarBloqueado ? (
          <>
            <Clock className="h-5 w-5" />
            <span className="text-xs font-semibold">{falta ? `En ${falta}` : "Sin cupo"}</span>
          </>
        ) : (
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        )}
      </button>

      {fundar && (
        <FundarDrawer onClose={() => setFundar(false)} lat={lat} lng={lng} cuotaInicial={cuota} />
      )}
    </div>
  );
}

function EstadoVacio({
  icono,
  titulo,
  texto,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-2 py-14 text-center">
      <div className="mx-auto max-w-sm">
        <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
          {icono}
        </div>
        <h3 className="mb-2 font-heading text-[20px] font-bold text-[color:var(--fg)]">{titulo}</h3>
        <p className="mb-5 text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">{texto}</p>
        {children}
      </div>
    </div>
  );
}
