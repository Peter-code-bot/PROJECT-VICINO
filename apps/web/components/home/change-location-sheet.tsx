"use client";

import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Search, LocateFixed, Check, X, Loader2, MapPin, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  clasificarResultado,
  searchLocations,
  resolveLocationCoordinates,
  type LocationSearchResult,
} from "@/lib/geo/location-search";
import { useReglaCobertura } from "@/lib/geo/cobertura";
import { hayCambiosDeUbicacion, mismoPunto } from "@/lib/geo/cambios-ubicacion";
import { hapticSelection } from "@/lib/haptics";
import { reverseGeocodeWithApple } from "@/lib/geo/apple-geocoder";
import type { GeoPosition } from "@/lib/geo/location-storage";

const ChangeLocationMap = dynamic(() => import("./change-location-map"), {
  ssr: false,
  loading: () => (
    <div className="mx-5 flex h-[200px] items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand-hi)]" />
    </div>
  ),
});

const PUEBLA_DEFAULT = { lat: 19.0414, lng: -98.2063 };
const RECENTS_KEY = "vicino_recent_locations";
const MAX_RECENTS = 5;
const MATCH_TOLERANCE = 0.0001; // ~11 m

export interface SavedLocation {
  lat: number;
  lng: number;
  name: string;
  fullName: string;
  timestamp: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** An explicit link affects this draft only; persistence still requires Apply. */
  initialPositionOverride?: GeoPosition | null;
}

function isValidSavedLocation(x: unknown): x is SavedLocation {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.lat === "number" &&
    Number.isFinite(r.lat) &&
    Math.abs(r.lat) <= 90 &&
    typeof r.lng === "number" &&
    Number.isFinite(r.lng) &&
    Math.abs(r.lng) <= 180 &&
    typeof r.name === "string" &&
    typeof r.fullName === "string" &&
    typeof r.timestamp === "number"
  );
}

function readRecents(): SavedLocation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSavedLocation).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(items: SavedLocation[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
  } catch {
    // quota o modo privado — ignorar
  }
}

function dedupAndPrepend(
  list: SavedLocation[],
  item: SavedLocation,
): SavedLocation[] {
  const filtered = list.filter(
    (l) =>
      Math.abs(l.lat - item.lat) >= MATCH_TOLERANCE ||
      Math.abs(l.lng - item.lng) >= MATCH_TOLERANCE,
  );
  return [item, ...filtered].slice(0, MAX_RECENTS);
}


async function reverseGeocodeOnce(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<{ name: string; fullName: string }> {
  try {
    const res = await reverseGeocodeWithApple(lat, lng, signal);
    if (res?.name) {
      return { name: res.name, fullName: res.fullName };
    }
  } catch {
    // silenciar
  }
  return { name: "Mi ubicación", fullName: "Mi ubicación" };
}

export function ChangeLocationSheet({ open, onClose, initialPositionOverride }: Props) {
  const router = useRouter();
  const cobertura = useReglaCobertura();
  const { state, setManualPosition } = useGeolocation();
  const storedPosition =
    state.status === "success" ? state.position : null;
  const overrideLat = initialPositionOverride?.lat, overrideLng = initialPositionOverride?.lng;
  const overrideRadius = initialPositionOverride?.radius;
  const overrideName = initialPositionOverride?.name, overrideFullName = initialPositionOverride?.fullName;
  const hasOverride = initialPositionOverride !== undefined;
  const activePosition = useMemo<GeoPosition | null>(() => {
    if (!hasOverride) return storedPosition;
    if (overrideLat === undefined || overrideLng === undefined || clasificarResultado({ lat: overrideLat, lng: overrideLng }, null) !== "ok") return null;
    const matchesStored = mismoPunto({ lat: overrideLat, lng: overrideLng }, storedPosition);
    return { lat: overrideLat, lng: overrideLng, radius: overrideRadius ?? storedPosition?.radius,
      name: overrideName ?? (matchesStored ? storedPosition?.name : undefined),
      fullName: overrideFullName ?? (matchesStored ? storedPosition?.fullName : undefined) };
  }, [hasOverride, overrideLat, overrideLng, overrideRadius, overrideName, overrideFullName, storedPosition]);

  const [center, setCenter] = useState<{ lat: number; lng: number }>(
    activePosition ?? PUEBLA_DEFAULT,
  );
  const [view, setView] = useState(center);
  const [draft, setDraft] = useState<SavedLocation | null>(null);
  const [draftRadius, setDraftRadius] = useState(activePosition?.radius ?? 10000);
  const [centerLabels, setCenterLabels] = useState<{
    zone: string | null;
    city: string | null;
  }>({ zone: null, city: null });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [recents, setRecents] = useState<SavedLocation[]>([]);
  const [requestingGps, setRequestingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // El borrador ya es el de ESTA apertura. Sin esto, al reabrir despues de
  // descartar, el primer frame calculaba la palomita con el borrador viejo.
  const [borradorListo, setBorradorListo] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);
  const draftTouchedRef = useRef(false);
  const invalidatePending = useCallback(() => {
    searchSeqRef.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
  }, []);
  const cancelPending = useCallback(() => {
    draftTouchedRef.current = true;
    invalidatePending();
    setRequestingGps(false);
    setSearching(false);
  }, [invalidatePending]);
  const closeSheet = useCallback(() => {
    openRef.current = false;
    cancelPending();
    setBorradorListo(false);
    onClose();
  }, [cancelPending, onClose]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
    setMounted(true);
  }, []);

  useEffect(() => {
    openRef.current = open;
    draftTouchedRef.current = false;
    return () => {
      openRef.current = false;
      invalidatePending();
    };
  }, [open, invalidatePending]);

  useBodyScrollLock(open);

  // A4 sub-fase 4.2 (codex follow-up): Escape listener para el smart back
  // button del APK (dispatch sintetico cuando data-modal-open="true").
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeSheet();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeSheet]);

  // Reset state al abrir
  useEffect(() => {
    if (!open || draftTouchedRef.current) return;
    startTransition(() => {
      setRecents(readRecents());
      setCenter(activePosition ?? PUEBLA_DEFAULT);
      setView(activePosition ?? PUEBLA_DEFAULT);
      const previous = activePosition;
      setDraft(previous ? { ...previous, name: previous.name ?? "Mi ubicación", fullName: previous.fullName ?? "Mi ubicación", timestamp: Date.now() } : null);
      setDraftRadius(previous?.radius ?? 10000);
      setQuery("");
      setResults([]);
      setSearching(false);
      setGpsError(null);
      setRequestingGps(false);
      setSearchNotice(null);
      setBorradorListo(true);
    });
  }, [open, activePosition]);

  // Reverse geocode del centro para overlays del mapa
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    reverseGeocodeOnce(center.lat, center.lng, controller.signal).then(
      (res) => {
        if (controller.signal.aborted) return;
        // Para los overlays sólo necesitamos las dos partes por separado.
        const parts = res.name.split(",").map((s) => s.trim());
        setCenterLabels({
          zone: parts[0] ?? null,
          city: parts[1] ?? null,
        });
      },
    );
    return () => controller.abort();
  }, [open, center.lat, center.lng]);

  const handleSearchChange = useCallback(
    (v: string) => {
      cancelPending();
      setQuery(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();

      if (v.trim().length < 3) {
        setResults([]);
        setSearchNotice(null);
        setSearching(false);
        return;
      }
      setSearchNotice(null);
      setSearching(true);
      const currentSeq = ++searchSeqRef.current;

      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        searchAbortRef.current = controller;

        try {
          const data = await searchLocations(v, {
            center: { lat: center.lat, lng: center.lng },
            limit: 5,
            signal: controller.signal,
            cobertura,
          });
          if (searchSeqRef.current === currentSeq && !controller.signal.aborted) {
            setResults(data.results);
            setSearchNotice(
              data.reason === "fuera-de-mexico"
                ? "Ese lugar está fuera de México."
                : data.outOfCoverage
                ? "Encontramos ese lugar, pero está fuera de la zona donde VICINO opera por ahora."
                : null,
            );
          }
        } catch {
          if (searchSeqRef.current === currentSeq) {
            setResults([]);
            setSearchNotice(null);
          }
        } finally {
          if (searchSeqRef.current === currentSeq) {
            setSearching(false);
          }
        }
      }, 350);
    },
    [center.lat, center.lng, cancelPending, cobertura],
  );

  const selectLocation = useCallback(
    (loc: SavedLocation, recenter = true) => {
      if (!openRef.current) return;
      cancelPending();
      const valid = clasificarResultado({ lat: loc.lat, lng: loc.lng }, null);
      if (valid !== "ok") {
        setSearchNotice(valid === "fuera-de-mexico"
          ? "La ubicación debe estar en México."
          : "No pudimos comprobar las coordenadas de esa ubicación.");
        return false;
      }
      setDraft(loc);
      setCenter({ lat: loc.lat, lng: loc.lng });
      if (recenter) setView({ lat: loc.lat, lng: loc.lng });
      setQuery(loc.name);
      setResults([]);
      setSearchNotice(null);
      setGpsError(null);
      return true;
    },
    [cancelPending],
  );

  // Tarea 8 (decision de Pedro, 27-sep): con cambios pendientes la X del
  // header pasa a palomita y aplica; ya no hay boton "Aplicar ubicacion" al
  // fondo, que quedaba fuera de vista (la hoja mide hasta 85vh con scroll).
  // Solo se ofrece aplicar lo que se puede aplicar: un borrador fuera de
  // Mexico (p. ej. una ubicacion activa por GPS en EE. UU. a la que solo se le
  // cambia el radio) dejaba una palomita que no hacia nada.
  const borradorValido = !!draft && clasificarResultado(draft, null) === "ok";
  const hayCambios =
    borradorListo && borradorValido && hayCambiosDeUbicacion(draft, draftRadius, storedPosition);
  const aplicarBloqueado = searching || requestingGps;

  const applyLocation = () => {
    if (!openRef.current || !draft) return;
    if (clasificarResultado(draft, null) !== "ok") {
      setSearchNotice("La ubicación debe estar en México. Busca otra zona o mueve el mapa.");
      return;
    }
    void hapticSelection();
    cancelPending();
    setManualPosition({ ...draft, radius: draftRadius });
    writeRecents(dedupAndPrepend(recents, { ...draft, timestamp: Date.now() }));
    closeSheet();
    router.refresh();
  };

  const handleSelectResult = useCallback(
    async (r: LocationSearchResult) => {
      cancelPending();
      const sequence = searchSeqRef.current;
      setSearching(true);
      try {
      const resolved = await resolveLocationCoordinates(r, {
        lat: center.lat,
        lng: center.lng,
      }, undefined, cobertura);
      if (!openRef.current || sequence !== searchSeqRef.current) return;
      setSearching(false);

      // Si la resolucion no dio coordenadas buenas NO se guarda nada. Guardar
      // aqui era mover al usuario al centro del mapa con el nombre del sitio que
      // habia pedido: feed equivocado, etiqueta correcta, nadie se entera.
      if (resolved.needsResolution || !Number.isFinite(resolved.lat) || !Number.isFinite(resolved.lng)) {
        setSearchNotice(
          resolved.rejectionReason === "fuera-de-mexico"
            ? "Ese lugar está fuera de México."
            : resolved.outOfCoverage
            ? "Ese lugar está fuera de la zona donde VICINO opera por ahora."
            : "No pudimos ubicar ese lugar. Intenta con otro nombre o usa tu ubicación actual.",
        );
        return;
      }

      selectLocation({
        lat: resolved.lat,
        lng: resolved.lng,
        name: resolved.name,
        fullName: resolved.fullName,
        timestamp: Date.now(),
      });
      } catch {
        if (openRef.current && sequence === searchSeqRef.current) {
          setSearchNotice("No se pudo elegir esa ubicación. Intenta de nuevo.");
        }
      } finally {
        if (openRef.current && sequence === searchSeqRef.current) setSearching(false);
      }
    },
    [selectLocation, center.lat, center.lng, cancelPending, cobertura],
  );

  const handleUseMyLocation = useCallback(() => {
    cancelPending();
    const sequence = searchSeqRef.current;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Geolocalización no disponible en este dispositivo");
      return;
    }
    setRequestingGps(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!openRef.current || sequence !== searchSeqRef.current) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const { name, fullName } = await reverseGeocodeOnce(lat, lng);
        // Si el usuario cerró el sheet mientras esperábamos el GPS,
        // abandonar — no queremos cambiar su ubicación silenciosamente.
        if (!openRef.current || sequence !== searchSeqRef.current) return;
        setRequestingGps(false);
        selectLocation({ lat, lng, name, fullName, timestamp: Date.now() });
      },
      (err) => {
        if (!openRef.current || sequence !== searchSeqRef.current) return;
        setRequestingGps(false);
        const message =
          err.code === 1
            ? "Permiso de ubicación denegado"
            : err.code === 2
              ? "Ubicación no disponible"
              : "Tiempo de espera agotado";
        setGpsError(message);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, [selectLocation, cancelPending]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeSheet}
            className="fixed inset-0 md:left-64 z-[100] bg-black/60 backdrop-blur-sm"
            aria-hidden
          />
          <div className="pointer-events-none fixed inset-0 md:left-64 z-[100] flex items-end" data-modal-open="true">
            <motion.div
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Cambiar ubicación"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="pointer-events-auto w-full overflow-y-auto rounded-t-3xl bg-[color:var(--bg)] pb-[calc(env(safe-area-inset-bottom)_+_2rem)]"
              style={{ maxHeight: "85vh" }}
            >
              {/* Asa y header fijos: la palomita tiene que verse aunque el
                  usuario haya bajado a "Ubicaciones recientes". z por encima
                  de la lista de resultados del buscador (z-60). */}
              <div className="sticky top-0 z-[70] bg-[color:var(--bg)]">
              {/* Handle */}
              <div className="mx-auto mt-3 mb-4 h-1 w-12 rounded-full bg-[color:var(--fg-dim)]/30" />

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-4">
                <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
                  Cambiar ubicación
                </h2>
                {/* Sin cambios: X que cierra. Con cambios (pin, buscador, GPS,
                    reciente o radio): la misma pieza con la palomita de
                    "Ubicacion actual" y aplica. Descartar sigue siendo tocar
                    fuera, Escape o el Atras de Android. */}
                <button
                  type="button"
                  onClick={hayCambios ? applyLocation : closeSheet}
                  disabled={hayCambios && aplicarBloqueado}
                  aria-label={hayCambios ? "Aplicar ubicación" : "Cerrar"}
                  data-accion={hayCambios ? "aplicar" : "cerrar"}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] transition-colors hover:bg-[color:var(--border)] active:bg-[color:var(--border-strong)] disabled:opacity-40"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={hayCambios ? "aplicar" : "cerrar"}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex"
                    >
                      {hayCambios ? (
                        <Check size={18} className="text-[color:var(--brand-hi)]" />
                      ) : (
                        <X size={18} className="text-[color:var(--fg-muted)]" />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </button>
                {/* Lector de pantalla: con la palomita ya no hay un control
                    con nombre para descartar (el fondo es aria-hidden y en
                    iOS no hay Atras). Invisible, no cambia el diseno. */}
                {hayCambios && (
                  <button type="button" onClick={closeSheet} className="sr-only">
                    Descartar cambios
                  </button>
                )}
                <p className="sr-only" aria-live="polite">
                  {hayCambios && draft
                    ? `Ubicación sin aplicar: ${draft.name}. Confírmala con Aplicar ubicación, arriba.`
                    : ""}
                </p>
              </div>
              </div>

              {/* Map */}
              <ChangeLocationMap
                lat={center.lat}
                lng={center.lng}
                view={view}
                onMove={(lat, lng) => selectLocation({ lat, lng, name: `Punto del mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, fullName: `Punto del mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`, timestamp: Date.now() }, false)}
                zoneLabel={centerLabels.zone}
                cityLabel={centerLabels.city}
              />

              {/* Search */}
              <div className="relative mx-5 mt-4">
                <div className="flex items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--brand-hi)]">
                  <Search
                    size={16}
                    className="flex-shrink-0 text-[color:var(--fg-dim)]"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Buscar zona, colonia o dirección…"
                    className="w-full bg-transparent text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)] outline-none"
                  />
                  {searching && (
                    <Loader2
                      size={14}
                      className="flex-shrink-0 animate-spin text-[color:var(--fg-dim)]"
                    />
                  )}
                </div>

                {searchNotice && (
                  <p
                    role="status"
                    className="mt-2 rounded-xl bg-[color:var(--card-2)] px-3 py-2 text-xs leading-snug text-[color:var(--fg-dim)]"
                  >
                    {searchNotice}
                  </p>
                )}

                {results.length > 0 && (
                  <div className="absolute left-0 right-0 z-[60] mt-1 overflow-hidden rounded-2xl bg-[color:var(--card-2)] shadow-[0_0_0_1px_var(--border),0_8px_24px_rgba(0,0,0,0.4)]">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleSelectResult(r)}
                        className="flex min-h-[48px] w-full items-start gap-2.5 px-4 py-3 text-left text-sm text-[color:var(--fg)] transition-colors hover:bg-[color:var(--card)] active:bg-[color:var(--card)] border-b border-[color:var(--border)]/40 last:border-0"
                      >
                        <MapPin
                          size={16}
                          className="mt-0.5 flex-shrink-0 text-[color:var(--brand-hi)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{r.name}</span>
                            {r.distanceKm !== undefined && (
                              <span className="shrink-0 text-[11px] text-[color:var(--fg-dim)]">
                                {r.distanceKm < 1 ? "< 1 km" : `${r.distanceKm.toFixed(1)} km`}
                              </span>
                            )}
                          </div>
                          {r.subtitle && (
                            <p className="line-clamp-1 text-xs text-[color:var(--fg-dim)] mt-0.5">
                              {r.subtitle}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Radio de búsqueda */}
              <div className="mx-5 mt-5">
                <label className="text-[10px] font-medium uppercase tracking-widest text-[color:var(--fg-dim)]">
                  Radio de búsqueda general
                </label>
                <div className="mt-2 relative">
                  <select
                    value={draftRadius}
                    onChange={(e) => {
                      draftTouchedRef.current = true;
                      const newRadius = parseInt(e.target.value, 10);
                      setDraftRadius(newRadius);
                    }}
                    className="w-full appearance-none rounded-2xl bg-[color:var(--card-2)] px-4 py-3.5 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_var(--brand-hi)]"
                  >
                    <option value={1000}>1 km (Caminando)</option>
                    <option value={2000}>2 km (Colonia)</option>
                    <option value={5000}>5 km (Zona cercana)</option>
                    <option value={10000}>10 km (Media ciudad)</option>
                    <option value={25000}>25 km (Ciudad completa)</option>
                    <option value={50000}>50 km (Área metropolitana)</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                    <ChevronDown size={16} className="text-[color:var(--fg-dim)]" />
                  </div>
                </div>
              </div>

              {/* Usar mi ubicación */}
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={requestingGps}
                className={cn(
                  "mx-5 mt-3 flex w-[calc(100%-2.5rem)] min-h-[56px] items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3",
                  "shadow-[inset_0_0_0_1px_var(--border)] transition-all",
                  "hover:shadow-[inset_0_0_0_1px_var(--brand-hi)] active:bg-[color:var(--card)]",
                  "disabled:opacity-60",
                )}
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)]">
                  {requestingGps ? (
                    <Loader2
                      size={18}
                      className="animate-spin text-[color:var(--brand-hi)]"
                    />
                  ) : (
                    <LocateFixed
                      size={18}
                      className="text-[color:var(--brand-hi)]"
                    />
                  )}
                </span>
                <span className="flex flex-col items-start text-left">
                  <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">
                    Usar mi ubicación actual
                  </span>
                  <span className="text-xs text-[color:var(--fg-muted)]">
                    {gpsError ?? "Requiere permisos de ubicación"}
                  </span>
                </span>
              </button>

              {/* Recientes */}
              <div className="px-5 pt-5">
                <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-[color:var(--fg-dim)]">
                  Ubicaciones recientes
                </h3>
                {recents.length === 0 ? (
                  <p className="py-3 text-sm text-[color:var(--fg-muted)]">
                    Aún no tienes ubicaciones guardadas.
                  </p>
                ) : (
                  <ul className="-mx-1">
                    {recents.map((loc) => {
                      // mismoPunto y no sameLoc: la ubicacion activa vuelve de
                      // la cookie con 3 decimales (ver cambios-ubicacion.ts).
                      const active = mismoPunto(activePosition, loc);
                      return (
                        <li key={`${loc.lat},${loc.lng},${loc.timestamp}`}>
                          <button
                            type="button"
                            onClick={() =>
                              selectLocation({ ...loc, timestamp: Date.now() })
                            }
                            className={cn(
                              "flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-xl border-t border-[color:var(--border)] px-1 py-3 text-left transition-colors first:border-t-0",
                              "active:bg-[color:var(--card-2)]/40",
                            )}
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-sm font-medium text-[color:var(--fg)]">
                                {loc.name}
                              </span>
                              {active && (
                                <span className="text-xs text-[color:var(--brand-hi)]">
                                  Ubicación actual
                                </span>
                              )}
                            </span>
                            {active && (
                              <Check
                                size={16}
                                className="flex-shrink-0 text-[color:var(--brand-hi)]"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
