"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Lock, Globe, MapPin, Archive, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMMUNITY_DESCRIPCION_MAX } from "@vicino/shared";
import {
  editarDescripcion,
  editarVisibilidad,
  archivarComunidad,
} from "@/app/(marketplace)/comunidades/actions";
import type {
  DetalleComunidad,
  CentroComunidad,
  SolicitudEnCola,
  MiembroComunidad,
  CursorComunidad,
} from "@/lib/comunidades/tipos";
import { ConfirmarDialog } from "../confirmar-dialog";
import { MoverCentroSheet } from "./mover-centro-sheet";
import { ModeradoresPanel } from "./moderadores-panel";
import { SolicitudesCola } from "./solicitudes-cola";

interface AdminPanelProps {
  detalle: DetalleComunidad;
  /** null cuando no soy owner (la RPC devuelve cero filas) o fallo la lectura. */
  centro: CentroComunidad | null;
  solicitudes: { items: SolicitudEnCola[]; cursor: CursorComunidad | null; error?: string };
  miembros: { items: MiembroComunidad[]; error?: string };
  topeModeradores: number;
}

function Seccion({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="px-1">
        <h2 className="font-heading text-[15px] font-bold text-[color:var(--fg)]">{titulo}</h2>
        {texto && <p className="text-xs text-[color:var(--fg-muted)]">{texto}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Administracion de una comunidad. El owner ve todo; un moderador solo la
 * cola de solicitudes (decision 5). El nombre no se edita: es inmutable
 * (decision 1).
 */
export function AdminPanel({ detalle, centro: centroInicial, solicitudes, miembros, topeModeradores }: AdminPanelProps) {
  const router = useRouter();
  const esOwner = detalle.mi_rol === "owner";

  const [descripcion, setDescripcion] = useState(detalle.descripcion ?? "");
  const [guardandoDesc, setGuardandoDesc] = useState(false);
  const [privada, setPrivada] = useState(detalle.es_privada);
  const [cambiandoVis, setCambiandoVis] = useState(false);
  const [centro, setCentro] = useState<CentroComunidad | null>(centroInicial);
  const [moverAbierto, setMoverAbierto] = useState(false);
  const [confirmarArchivar, setConfirmarArchivar] = useState(false);
  const [archivando, setArchivando] = useState(false);

  const descCambiada = descripcion.trim() !== (detalle.descripcion ?? "").trim();

  async function guardarDescripcion() {
    if (!descCambiada || guardandoDesc) return;
    setGuardandoDesc(true);
    const r = await editarDescripcion({ community_id: detalle.id, descripcion: descripcion.trim() || null });
    setGuardandoDesc(false);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    toast.success("Descripción guardada");
    router.refresh();
  }

  async function cambiarVisibilidad() {
    if (cambiandoVis) return;
    const siguiente = !privada;
    setCambiandoVis(true);
    setPrivada(siguiente);
    const r = await editarVisibilidad({ community_id: detalle.id, es_privada: siguiente });
    setCambiandoVis(false);
    if ("error" in r) {
      setPrivada(!siguiente);
      toast.error(r.error);
      return;
    }
    setPrivada(r.data.es_privada);
    toast.success(r.data.es_privada ? "La comunidad ahora es privada" : "La comunidad ahora es pública");
  }

  async function archivar() {
    setArchivando(true);
    const r = await archivarComunidad(detalle.id);
    setArchivando(false);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    setConfirmarArchivar(false);
    toast.success("Comunidad archivada");
    router.push("/?feed=comunidades&tab=mias");
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-7 px-4 pt-3 pb-28">
      <div className="flex items-center gap-3">
        <Link
          href={`/comunidades/${detalle.id}`}
          aria-label="Volver a la comunidad"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">Administrar</p>
          <h1 className="truncate font-heading text-xl font-bold text-[color:var(--fg)]">{detalle.nombre}</h1>
        </div>
      </div>

      {privada && (
        <Seccion
          titulo="Solicitudes para unirse"
          texto="Quienes piden entrar. Tú y los moderadores pueden aceptar o rechazar."
        >
          <SolicitudesCola
            communityId={detalle.id}
            iniciales={solicitudes.items}
            cursor={solicitudes.cursor}
            error={solicitudes.error}
          />
        </Seccion>
      )}

      {esOwner && (
        <>
          <Seccion titulo="Descripción" texto="El nombre no se puede cambiar; la descripción sí.">
            <div className="rounded-2xl bg-[color:var(--card)] p-3 shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--brand-hi)]">
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value.slice(0, COMMUNITY_DESCRIPCION_MAX))}
                rows={3}
                maxLength={COMMUNITY_DESCRIPCION_MAX}
                placeholder="De qué va esta comunidad y para quién es"
                aria-label="Descripción de la comunidad"
                className="w-full resize-none bg-transparent text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)]"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-[color:var(--fg-dim)]">
                  {descripcion.length}/{COMMUNITY_DESCRIPCION_MAX}
                </span>
                <button
                  type="button"
                  onClick={() => void guardarDescripcion()}
                  disabled={!descCambiada || guardandoDesc}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[color:var(--fg)] px-4 text-[13px] font-semibold text-[color:var(--bg)] transition-all disabled:opacity-40"
                >
                  {guardandoDesc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar
                </button>
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Visibilidad">
            <button
              type="button"
              role="switch"
              aria-checked={privada}
              onClick={() => void cambiarVisibilidad()}
              disabled={cambiandoVis}
              className="flex w-full items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--brand-hi)] disabled:opacity-70"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
                {privada ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">Comunidad privada</span>
                <span className="text-xs text-[color:var(--fg-muted)]">
                  {privada
                    ? "Solo entra quien tú o tus moderadores aprueben. El muro no se ve desde fuera."
                    : "Cualquiera cerca puede ver el muro y unirse sin pedir permiso."}
                </span>
              </span>
              <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", privada ? "bg-[color:var(--brand)]" : "bg-[color:var(--fg-dim)]/40")}>
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", privada ? "translate-x-5" : "translate-x-0.5")} />
              </span>
            </button>
          </Seccion>

          <Seccion
            titulo="Centro de la comunidad"
            texto="Es una zona aproximada, no una dirección. Se puede mover hasta 1 km del punto de fundación."
          >
            {centro ? (
              <div className="flex items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
                  <MapPin className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[color:var(--fg)]">
                    {centro.lat.toFixed(2)}, {centro.lng.toFixed(2)}
                  </p>
                  <p className="text-xs text-[color:var(--fg-muted)]">
                    {centro.movimientos_restantes_24h} {centro.movimientos_restantes_24h === 1 ? "movimiento" : "movimientos"} disponibles hoy
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoverAbierto(true)}
                  className="inline-flex h-9 shrink-0 items-center rounded-full bg-[color:var(--fg)] px-4 text-[13px] font-semibold text-[color:var(--bg)]"
                >
                  Mover
                </button>
              </div>
            ) : (
              <p className="rounded-2xl bg-[color:var(--card-2)] px-4 py-3 text-xs text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
                No se pudo leer el centro ahora mismo.
              </p>
            )}
            {centro && (
              <MoverCentroSheet
                open={moverAbierto}
                onClose={() => setMoverAbierto(false)}
                communityId={detalle.id}
                centro={centro}
                onMovido={setCentro}
              />
            )}
          </Seccion>

          <Seccion titulo="Moderadores" texto="Nombra a personas de confianza. Solo tú puedes nombrar o quitar.">
            <ModeradoresPanel
              communityId={detalle.id}
              miembros={miembros.items}
              topeModeradores={topeModeradores}
              error={miembros.error}
            />
          </Seccion>

          <Seccion titulo="Archivar" texto="La comunidad deja de verse y nadie puede publicar. Quienes ya son miembros pueden leer lo que quedó y salir.">
            <button
              type="button"
              onClick={() => setConfirmarArchivar(true)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[color:var(--danger)]/10 px-5 text-[14px] font-semibold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)]/15"
            >
              <Archive className="h-4 w-4" />
              Archivar comunidad
            </button>
            <ConfirmarDialog
              open={confirmarArchivar}
              onOpenChange={setConfirmarArchivar}
              titulo={`Archivar ${detalle.nombre}`}
              cuerpo="La comunidad desaparecerá de Descubrir y del muro unificado. Nadie podrá publicar ni unirse. No se puede deshacer desde la app."
              confirmar="Archivar"
              peligroso
              pendiente={archivando}
              onConfirmar={() => void archivar()}
            />
          </Seccion>
        </>
      )}

      {!esOwner && !privada && (
        <p className="text-sm text-[color:var(--fg-muted)]">
          Esta comunidad es pública: entra quien quiera y no hay solicitudes que revisar.
        </p>
      )}
    </div>
  );
}
