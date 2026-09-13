"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { Search, LocateFixed, Loader2, MapPin, X } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  searchLocations,
  resolveLocationCoordinates,
  type LocationSearchResult,
} from "@/lib/geo/location-search";
import { reverseGeocodeWithApple } from "@/lib/geo/apple-geocoder";

const AppleMapContainer = dynamic(() => import("./apple-map-container"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[240px] items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
    </div>
  ),
});

const DEFAULT_PUEBLA: [number, number] = [19.0414, -98.2063];

interface OnboardingLocationMapProps {
  onLocationConfirmed?: (lat: number, lng: number, address: string) => void;
}

export default function OnboardingLocationMap({
  onLocationConfirmed,
}: OnboardingLocationMapProps) {
  const { state, setManualPosition } = useGeolocation();
  const initialCoords: [number, number] =
    state.status === "success" && state.position
      ? [state.position.lat, state.position.lng]
      : DEFAULT_PUEBLA;

  const [position, setPosition] = useState<[number, number]>(initialCoords);
  const [addressLabel, setAddressLabel] = useState<string>(
    state.status === "success" && state.position?.name
      ? state.position.name
      : ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [requestingGps, setRequestingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef<number>(0);

  // Guardar posición en hook y sincronizar cookies / localStorage
  const commitPosition = useCallback(
    (lat: number, lng: number, label: string) => {
      setPosition([lat, lng]);
      setAddressLabel(label);
      setManualPosition({
        lat,
        lng,
        name: label,
        fullName: label,
      });
      onLocationConfirmed?.(lat, lng, label);
    },
    [setManualPosition, onLocationConfirmed]
  );

  // Reverse geocoding diferido con Apple MapKit Geocoder (P1-1)
  const handlePositionChange = useCallback(
    (lat: number, lng: number) => {
      setPosition([lat, lng]);
      const provisional = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      commitPosition(lat, lng, provisional);

      if (reverseRef.current) clearTimeout(reverseRef.current);
      reverseAbortRef.current?.abort();

      reverseRef.current = setTimeout(() => {
        const controller = new AbortController();
        reverseAbortRef.current = controller;

        reverseGeocodeWithApple(lat, lng, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return;
            if (data?.name) {
              commitPosition(lat, lng, data.name);
            }
          })
          .catch(() => {});
      }, 800);
    },
    [commitPosition]
  );

  useEffect(() => {
    return () => {
      if (reverseRef.current) clearTimeout(reverseRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      reverseAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, []);

  // Buscador de direcciones con cancelacion y descarte de respuestas viejas (P0-2, P1-3)
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    searchAbortRef.current?.abort();

    if (q.trim().length < 3) {
      setSuggestions([]);
      setSearching(false);
      setHasSearched(false);
      return;
    }

    setSearching(true);
    const currentSeq = ++searchSeqRef.current;

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const results = await searchLocations(q, {
          center: { lat: position[0], lng: position[1] },
          limit: 5,
          signal: controller.signal,
        });

        // Descartar si una consulta más reciente ya se disparó
        if (searchSeqRef.current === currentSeq && !controller.signal.aborted) {
          setSuggestions(results);
          setHasSearched(true);
        }
      } catch {
        if (searchSeqRef.current === currentSeq) {
          setSuggestions([]);
          setHasSearched(true);
        }
      } finally {
        if (searchSeqRef.current === currentSeq) {
          setSearching(false);
        }
      }
    }, 350);
  };

  // Resolución de coordenadas al seleccionar (B-4)
  const selectSuggestion = async (s: LocationSearchResult) => {
    setSearchQuery(s.name);
    setSuggestions([]);
    setHasSearched(false);

    const resolved = await resolveLocationCoordinates(s, {
      lat: position[0],
      lng: position[1],
    });

    commitPosition(resolved.lat, resolved.lng, resolved.name);
  };

  // Confirmar dirección escrita manualmente (P1-5: salida sin bloqueo de mapa)
  const handleConfirmManualText = () => {
    const trimmed = searchQuery.trim();
    if (trimmed.length > 0) {
      commitPosition(position[0], position[1], trimmed);
      setSuggestions([]);
      setHasSearched(false);
    }
  };

  // Botón GPS
  const handleGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Geolocalización no disponible");
      return;
    }
    setRequestingGps(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRequestingGps(false);
        handlePositionChange(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setRequestingGps(false);
        setGpsError(
          err.code === 1
            ? "Permiso denegado"
            : "No se pudo obtener ubicación"
        );
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="space-y-3">
      {/* Buscador de dirección */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-2xl bg-[color:var(--card-2)] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--brand)]">
          <Search className="h-4 w-4 text-[color:var(--fg-dim)] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Busca tu colonia, municipio o código postal…"
            className="flex-1 bg-transparent text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSuggestions([]);
              }}
              className="text-[color:var(--fg-dim)] hover:text-[color:var(--fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {searching && (
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fg-dim)]" />
          )}
        </div>

        {/* Searching indicator dropdown */}
        {searching && suggestions.length === 0 && (
          <div className="absolute left-0 right-0 z-[60] mt-1.5 rounded-2xl bg-[color:var(--card-2)] p-3 text-xs text-[color:var(--fg-dim)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] border border-[color:var(--border)] flex items-center justify-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--brand)]" />
            <span>Buscando en México…</span>
          </div>
        )}

        {/* Sin resultados con opción manual (P1-5) */}
        {!searching && hasSearched && suggestions.length === 0 && searchQuery.trim().length >= 3 && (
          <div className="absolute left-0 right-0 z-[60] mt-1.5 rounded-2xl bg-[color:var(--card-2)] p-3 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.35)] border border-[color:var(--border)] space-y-2">
            <p className="text-[color:var(--fg-dim)]">
              No encontramos lugares con ese nombre.
            </p>
            <button
              type="button"
              onClick={handleConfirmManualText}
              className="w-full rounded-xl bg-[color:var(--brand)]/15 px-3 py-1.5 text-center font-medium text-[color:var(--brand)] hover:bg-[color:var(--brand)]/25"
            >
              Usar &ldquo;{searchQuery.trim()}&rdquo; como mi zona
            </button>
          </div>
        )}

        {/* Dropdown sugerencias */}
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-[60] mt-1.5 overflow-hidden rounded-2xl bg-[color:var(--card-2)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] border border-[color:var(--border)] max-h-56 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-xs text-[color:var(--fg)] hover:bg-[color:var(--card)] border-b border-[color:var(--border)]/40 last:border-0"
              >
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[color:var(--brand)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{s.name}</span>
                    {s.distanceKm !== undefined && (
                      <span className="shrink-0 text-[10px] text-[color:var(--fg-dim)]">
                        {s.distanceKm < 1 ? "< 1 km" : `${s.distanceKm.toFixed(1)} km`}
                      </span>
                    )}
                  </div>
                  {s.subtitle && (
                    <p className="line-clamp-1 text-[11px] text-[color:var(--fg-dim)] mt-0.5">
                      {s.subtitle}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mini-mapa interactivo */}
      <div className="relative overflow-hidden rounded-2xl shadow-sm border border-[color:var(--border)]">
        <AppleMapContainer
          center={position}
          markerPosition={position}
          draggableMarker
          onMarkerDragEnd={handlePositionChange}
          onMapClick={handlePositionChange}
          height={240}
        />

        {/* Badge inferior con dirección actual */}
        {addressLabel && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10 flex items-center justify-between rounded-xl bg-[color:var(--bg)]/90 backdrop-blur-md px-3 py-1.5 border border-[color:var(--border)]/80 text-xs">
            <div className="flex items-center gap-1.5 truncate">
              <MapPin className="h-3.5 w-3.5 text-[color:var(--brand)] shrink-0" />
              <span className="truncate font-medium text-[color:var(--fg)]">
                {addressLabel}
              </span>
            </div>
            <span className="text-[10px] text-[color:var(--fg-muted)] pl-2 shrink-0">
              Arrastra o toca el mapa
            </span>
          </div>
        )}
      </div>

      {/* Botón GPS */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={handleGps}
          disabled={requestingGps}
          className="inline-flex items-center gap-2 text-xs font-medium text-[color:var(--brand)] hover:underline disabled:opacity-50"
        >
          {requestingGps ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LocateFixed className="h-3.5 w-3.5" />
          )}
          <span>Usar mi ubicación actual</span>
        </button>

        {gpsError && (
          <span className="text-[11px] text-[color:var(--danger)]">
            {gpsError}
          </span>
        )}
      </div>
    </div>
  );
}
