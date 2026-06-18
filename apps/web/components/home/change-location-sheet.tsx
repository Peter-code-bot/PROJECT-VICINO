"use client";

import { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Search, LocateFixed, Check, X, Loader2, MapPin, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useRouter } from "next/navigation";

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

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface NominatimAddress {
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city?: string;
  town?: string;
  municipality?: string;
  postcode?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
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

function sameLoc(
  a: { lat: number; lng: number } | null,
  b: { lat: number; lng: number },
): boolean {
  if (!a) return false;
  return (
    Math.abs(a.lat - b.lat) < MATCH_TOLERANCE &&
    Math.abs(a.lng - b.lng) < MATCH_TOLERANCE
  );
}

function buildNameFromAddress(addr: NominatimAddress | undefined): {
  name: string;
  fullName: string;
} {
  const barrio = addr?.suburb ?? addr?.neighbourhood ?? addr?.quarter ?? null;
  const ciudad = addr?.city ?? addr?.town ?? addr?.municipality ?? null;
  let name = "";
  if (barrio && ciudad) name = `${barrio}, ${ciudad}`;
  else if (barrio) name = barrio;
  else if (ciudad) name = ciudad;
  const fullName = name && addr?.postcode ? `${name}, CP ${addr.postcode}` : name;
  return { name, fullName };
}

async function reverseGeocodeOnce(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<{ name: string; fullName: string }> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { signal },
    );
    if (!r.ok) throw new Error("HTTP error");
    const data = (await r.json()) as { address?: NominatimAddress };
    const built = buildNameFromAddress(data.address);
    if (built.name) return built;
  } catch {
    // silenciar
  }
  return { name: "Mi ubicación", fullName: "Mi ubicación" };
}

export function ChangeLocationSheet({ open, onClose }: Props) {
  const router = useRouter();
  const { state, setManualPosition, setRadius } = useGeolocation();
  const activePosition =
    state.status === "success" ? state.position : null;

  const [center, setCenter] = useState<{ lat: number; lng: number }>(
    activePosition ?? PUEBLA_DEFAULT,
  );
  const [centerLabels, setCenterLabels] = useState<{
    zone: string | null;
    city: string | null;
  }>({ zone: null, city: null });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<SavedLocation[]>([]);
  const [requestingGps, setRequestingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useBodyScrollLock(open);

  // A4 sub-fase 4.2 (codex follow-up): Escape listener para el smart back
  // button del APK (dispatch sintetico cuando data-modal-open="true").
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        router.refresh();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, router]);

  // Reset state al abrir
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setRecents(readRecents());
      setCenter(activePosition ?? PUEBLA_DEFAULT);
      setQuery("");
      setResults([]);
      setSearching(false);
      setGpsError(null);
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

  const handleSearchChange = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          v,
        )}&format=json&countrycodes=mx&limit=5`,
      )
        .then((r) => (r.ok ? r.json() : []))
        .then((data: NominatimResult[]) => {
          setResults(Array.isArray(data) ? data : []);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 500);
  }, []);

  const commit = useCallback(
    (loc: SavedLocation) => {
      setManualPosition({ lat: loc.lat, lng: loc.lng });
      const next = dedupAndPrepend(recents, loc);
      setRecents(next);
      writeRecents(next);
      onClose();
      router.refresh();
    },
    [recents, setManualPosition, onClose, router],
  );

  const handleSelectResult = useCallback(
    (r: NominatimResult) => {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const segments = r.display_name.split(",").map((s) => s.trim());
      const name = segments[0] ?? r.display_name;
      commit({
        lat,
        lng,
        name,
        fullName: r.display_name,
        timestamp: Date.now(),
      });
    },
    [commit],
  );

  const handleUseMyLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Geolocalización no disponible en este dispositivo");
      return;
    }
    setRequestingGps(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const { name, fullName } = await reverseGeocodeOnce(lat, lng);
        // Si el usuario cerró el sheet mientras esperábamos el GPS,
        // abandonar — no queremos cambiar su ubicación silenciosamente.
        if (!openRef.current) return;
        setRequestingGps(false);
        commit({ lat, lng, name, fullName, timestamp: Date.now() });
      },
      (err) => {
        if (!openRef.current) return;
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
  }, [commit]);

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
            onClick={() => {
              onClose();
              router.refresh();
            }}
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
              {/* Handle */}
              <div className="mx-auto mt-3 mb-4 h-1 w-12 rounded-full bg-[color:var(--fg-dim)]/30" />

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-4">
                <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
                  Cambiar ubicación
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.refresh();
                  }}
                  aria-label="Cerrar"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] transition-colors hover:bg-[color:var(--border)] active:bg-[color:var(--border-strong)]"
                >
                  <X size={18} className="text-[color:var(--fg-muted)]" />
                </button>
              </div>

              {/* Map */}
              <ChangeLocationMap
                lat={center.lat}
                lng={center.lng}
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

                {results.length > 0 && (
                  <div className="absolute left-0 right-0 z-[60] mt-1 overflow-hidden rounded-2xl bg-[color:var(--card-2)] shadow-[0_0_0_1px_var(--border),0_8px_24px_rgba(0,0,0,0.4)]">
                    {results.map((r, i) => (
                      <button
                        key={`${r.lat},${r.lon},${i}`}
                        type="button"
                        onClick={() => handleSelectResult(r)}
                        className="flex min-h-[48px] w-full items-start gap-2 px-4 py-3 text-left text-sm text-[color:var(--fg)] transition-colors hover:bg-[color:var(--card)] active:bg-[color:var(--card)]"
                      >
                        <MapPin
                          size={14}
                          className="mt-0.5 flex-shrink-0 text-[color:var(--brand-hi)]"
                        />
                        <span className="line-clamp-2">{r.display_name}</span>
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
                    value={activePosition?.radius ?? 2000}
                    onChange={(e) => {
                      const newRadius = parseInt(e.target.value, 10);
                      setRadius(newRadius);
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
                      const active = sameLoc(activePosition, loc);
                      return (
                        <li key={`${loc.lat},${loc.lng},${loc.timestamp}`}>
                          <button
                            type="button"
                            onClick={() =>
                              commit({ ...loc, timestamp: Date.now() })
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
