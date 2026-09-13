"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Loader2, MapPin, Lock, Globe, LocateFixed, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  COMMUNITY_NOMBRE_MIN,
  COMMUNITY_NOMBRE_MAX,
  COMMUNITY_DESCRIPCION_MAX,
} from "@vicino/shared";
import { fundarComunidad, estadoCuotaFundacion } from "@/app/(marketplace)/comunidades/actions";
import { tiempoQueFalta } from "@/lib/comunidades/errores";
import type { EstadoCuotaFundacion } from "@/lib/comunidades/tipos";

interface FundarDrawerProps {
  onClose: () => void;
  /** Ubicacion que el servidor ya tenia (cookie vicino_location). */
  lat: number | null;
  lng: number | null;
  /** Estado de cuota que trajo el servidor; se refresca al abrir. */
  cuotaInicial: EstadoCuotaFundacion;
}

/**
 * Sheet de fundacion (misma forma que create-request-drawer). Nombre (3-40,
 * inmutable despues), descripcion (<=300), interruptor "Comunidad privada"
 * apagado por defecto (decision 4) y centro = ubicacion actual; la RPC ya lo
 * redondea a la rejilla (decision 7).
 *
 * Decision 10: cuando estado_cuota_fundacion() dice que no, el boton se
 * deshabilita y muestra el tiempo que falta. No hay toast tras el fallo.
 */
export function FundarDrawer({ onClose, lat, lng, cuotaInicial }: FundarDrawerProps) {
  const router = useRouter();
  const { state, request } = useGeolocation();
  const [mounted, setMounted] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [privada, setPrivada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuota, setCuota] = useState<EstadoCuotaFundacion>(cuotaInicial);
  const [ahora, setAhora] = useState(() => Date.now());

  useBodyScrollLock(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
    setMounted(true);
  }, []);

  // Refresca la cuota al abrir: la del servidor puede tener minutos.
  useEffect(() => {
    let vivo = true;
    estadoCuotaFundacion().then((c) => {
      if (vivo) setCuota(c);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // El contador del boton deshabilitado avanza solo mientras haya espera.
  useEffect(() => {
    if (cuota.puede_fundar || !cuota.siguiente_en) return;
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [cuota.puede_fundar, cuota.siguiente_en]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, enviando]);

  // La ubicacion del servidor manda; si no la hay, la del hook (cache local o GPS).
  const posicion =
    lat !== null && lng !== null
      ? { lat, lng }
      : state.status === "success"
        ? { lat: state.position.lat, lng: state.position.lng }
        : null;

  const falta = tiempoQueFalta(cuota.siguiente_en, ahora);
  // Si la espera ya venció y el estado no se refrescó, no bloquear: la base decide.
  const bloqueadoPorCuota = !cuota.puede_fundar && (cuota.siguiente_en === null || falta !== null);
  const nombreValido =
    nombre.trim().length >= COMMUNITY_NOMBRE_MIN && nombre.trim().length <= COMMUNITY_NOMBRE_MAX;
  const puedeEnviar = !enviando && !bloqueadoPorCuota && nombreValido && posicion !== null;

  async function handleSubmit() {
    setError(null);
    if (!posicion) {
      setError("Necesitamos tu ubicación para poner el centro de la comunidad.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fundarComunidad({
        nombre,
        descripcion,
        lat: posicion.lat,
        lng: posicion.lng,
        es_privada: privada,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      if (privada && !r.data.es_privada) {
        toast.warning("La comunidad se fundó pero quedó pública. Puedes cerrarla desde Administrar.");
      } else {
        toast.success(`Fundaste ${r.data.nombre}`);
      }
      onClose();
      router.push(`/comunidades/${r.data.id}`);
    } catch {
      setError("Algo salió mal. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" data-modal-open="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={enviando ? undefined : onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fundar comunidad"
        className="relative flex h-[100dvh] w-full flex-col rounded-none border-t border-border/50 bg-card shadow-2xl animate-slide-up md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-3xl"
      >
        <div className="sticky top-0 z-10 shrink-0 rounded-none bg-card pt-2 pb-3 md:rounded-t-3xl">
          <div className="mx-auto mt-2 mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30 md:hidden" />
          <div className="flex items-center justify-between px-5">
            <h2 className="font-heading text-lg font-bold text-foreground">Fundar una comunidad</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={enviando}
              aria-label="Cerrar"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/80"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="fundar-nombre" className="text-sm font-medium text-foreground/80">
                Nombre
              </label>
              <span className="text-xs text-muted-foreground/70">
                {nombre.trim().length}/{COMMUNITY_NOMBRE_MAX}
              </span>
            </div>
            <input
              id="fundar-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value.replace(/[\n\r\t]/g, " "))}
              placeholder="Ej: Vecinos de La Paz"
              maxLength={COMMUNITY_NOMBRE_MAX}
              autoComplete="off"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground/70">
              Entre {COMMUNITY_NOMBRE_MIN} y {COMMUNITY_NOMBRE_MAX} caracteres. El nombre no se puede cambiar después.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="fundar-descripcion" className="text-sm font-medium text-foreground/80">
                Descripción <span className="font-normal text-muted-foreground/70">(opcional)</span>
              </label>
              <span className="text-xs text-muted-foreground/70">
                {descripcion.length}/{COMMUNITY_DESCRIPCION_MAX}
              </span>
            </div>
            <textarea
              id="fundar-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value.slice(0, COMMUNITY_DESCRIPCION_MAX))}
              placeholder="De qué va esta comunidad y para quién es"
              rows={3}
              maxLength={COMMUNITY_DESCRIPCION_MAX}
              className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={privada}
            onClick={() => setPrivada((p) => !p)}
            className="flex w-full items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--brand-hi)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
              {privada ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">Comunidad privada</span>
              <span className="text-xs text-[color:var(--fg-muted)]">
                {privada
                  ? "Solo entra quien tú o tus moderadores aprueben."
                  : "Cualquiera cerca puede ver el muro y unirse."}
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                privada ? "bg-[color:var(--brand)]" : "bg-[color:var(--fg-dim)]/40",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  privada ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </span>
          </button>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">Centro de la comunidad</label>
            {posicion ? (
              <div className="flex items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
                <MapPin className="h-4 w-4 shrink-0 text-[color:var(--brand-hi)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[color:var(--fg)]">Tu ubicación actual</p>
                  <p className="text-xs text-[color:var(--fg-muted)]">
                    Se guarda como zona aproximada, no tu dirección. Podrás moverlo hasta 1 km después.
                  </p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={request}
                disabled={state.status === "loading"}
                className="flex w-full items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--brand-hi)] disabled:opacity-60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
                  {state.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                </span>
                <span className="flex flex-col">
                  <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">Usar mi ubicación</span>
                  <span className="text-xs text-[color:var(--fg-muted)]">
                    {state.status === "error" ? state.message : "Necesaria para fijar el centro"}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/30 bg-card px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:rounded-b-3xl">
          {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
          {bloqueadoPorCuota && cuota.motivo && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-[color:var(--fg-muted)]">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {cuota.motivo}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!puedeEnviar}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {enviando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Fundando...
              </>
            ) : bloqueadoPorCuota ? (
              falta ? `Podrás fundar otra en ${falta}` : "No puedes fundar por ahora"
            ) : (
              "Fundar comunidad"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
