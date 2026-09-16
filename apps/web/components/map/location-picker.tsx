"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Search, MapPin, Loader2, X } from "lucide-react";
import {
  clasificarResultado,
  searchLocations,
  resolveLocationCoordinates,
  type LocationSearchResult,
} from "@/lib/geo/location-search";
import { useMapKit } from "@/hooks/use-mapkit";
import { reverseGeocodeWithApple } from "@/lib/geo/apple-geocoder";

const AppleMapContainer = dynamic(() => import("./apple-map-container"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[250px] items-center justify-center rounded-xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
    </div>
  ),
});

export interface LocationSelection { lat: number; lng: number; address: string }

interface LocationPickerProps {
  onChange: (value: LocationSelection | null) => void;
  onRadiusChange?: (km: number) => void;
  placeholder?: string;
  allowGeolocation?: boolean;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
}

export default function LocationPicker({
  onChange,
  placeholder = "Busca una dirección o localidad…",
  allowGeolocation = false,
  onRadiusChange,
  initialLat,
  initialLng,
  initialRadius = 5,
}: LocationPickerProps) {
  const mapkit = useMapKit();
  const hasInitial = initialLat !== undefined && initialLng !== undefined && Number.isFinite(initialLat) && Number.isFinite(initialLng);
  const [position, setPosition] = useState<[number, number]>(
    hasInitial ? [initialLat, initialLng] : [19.0414, -98.2063]
  );
  const [radius, setRadius] = useState(initialRadius);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [outOfCoverage, setOutOfCoverage] = useState(false);
  const [outsideMexico, setOutsideMexico] = useState(false);
  const [showMap, setShowMap] = useState(hasInitial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inversaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inversaAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef<number>(0);

  const [gpsPending, setGpsPending] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const cancelPending = useCallback(() => {
    searchSeqRef.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (inversaRef.current) clearTimeout(inversaRef.current);
    searchAbortRef.current?.abort();
    inversaAbortRef.current?.abort();
    setGpsPending(false);
    setSearching(false);
    setSuggestions([]);
  }, []);

  const handleDrag = useCallback(
    (lat: number, lng: number) => {
      cancelPending();
      if (clasificarResultado({ lat, lng }, null) !== "ok") {
        setLocationError("Ese punto está fuera de la cobertura de VICINO. Busca otra dirección.");
        setOutOfCoverage(true);
        setHasSearched(true);
        return false;
      }
      setPosition([lat, lng]);

      setShowMap(true);
      setLocationError(null);
      onChange({ lat, lng, address: "Zona seleccionada" });

      if (inversaRef.current) clearTimeout(inversaRef.current);
      inversaAbortRef.current?.abort();

      inversaRef.current = setTimeout(() => {
        const control = new AbortController();
        inversaAbortRef.current = control;
        reverseGeocodeWithApple(lat, lng, control.signal)
          .then((data) => {
            if (control.signal.aborted) return;
            if (data?.fullName) { setSearchQuery(data.fullName); onChange({ lat, lng, address: data.fullName }); }
          })
          .catch(() => {});
      }, 800);
      return true;
    },
    [onChange, cancelPending]
  );

  useEffect(() => {
    return () => {
      searchSeqRef.current++;
      if (inversaRef.current) clearTimeout(inversaRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      inversaAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, []);

  function handleSearch(q: string) {
    cancelPending();
    setSearchQuery(q);

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

        if (searchSeqRef.current === currentSeq && !controller.signal.aborted) {
          setSuggestions(results.results);
          setOutOfCoverage(results.outOfCoverage);
          setOutsideMexico(results.reason === "fuera-de-mexico");
          setHasSearched(true);
        }
      } catch {
        if (searchSeqRef.current === currentSeq) {
          setSuggestions([]);
          setOutOfCoverage(false);
          setOutsideMexico(false);
          setHasSearched(true);
        }
      } finally {
        if (searchSeqRef.current === currentSeq) {
          setSearching(false);
        }
      }
    }, 350);
  }

  async function selectSuggestion(s: LocationSearchResult) {
    cancelPending();
    const sequence = searchSeqRef.current;
    setSearchQuery(s.name);
    setSuggestions([]);
    setSearching(true);

    try {
    const resolved = await resolveLocationCoordinates(s, {
      lat: position[0],
      lng: position[1],
    });
    if (sequence !== searchSeqRef.current) return;
    setSearching(false);

    // Esta es la zona de entrega de un vendedor: plantarla en el centro del mapa
    // porque la resolucion fallo es peor que no hacer nada.
    if (resolved.needsResolution || !Number.isFinite(resolved.lat) || !Number.isFinite(resolved.lng)) {
      setOutOfCoverage(!!resolved.outOfCoverage);
      setOutsideMexico(resolved.rejectionReason === "fuera-de-mexico");
      setHasSearched(true);
      return;
    }

    setHasSearched(false);
    setOutOfCoverage(false);
    setOutsideMexico(false);
    setPosition([resolved.lat, resolved.lng]);
    setShowMap(true);
    setLocationError(null);
    onChange({ lat: resolved.lat, lng: resolved.lng, address: resolved.fullName });
    } catch {
      if (sequence === searchSeqRef.current) setLocationError("No se pudo elegir esa ubicación. Intenta de nuevo.");
    } finally {
      if (sequence === searchSeqRef.current) setSearching(false);
    }
  }

  function clearLocation() {
    cancelPending();
    setLocationError(null);
    setShowMap(false);
    setSearchQuery("");
    setSuggestions([]);
    setHasSearched(false);
    onChange(null);
  }

  function useMyLocation() {
    cancelPending();
    const sequence = searchSeqRef.current;
    setLocationError(null);
    if (!navigator.geolocation) { setLocationError("Geolocalización no disponible. Busca una dirección."); return; }
    setGpsPending(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (sequence !== searchSeqRef.current) return;
      handleDrag(coords.latitude, coords.longitude);
    }, () => {
      if (sequence !== searchSeqRef.current) return;
      setGpsPending(false);
      setLocationError("No pudimos obtener tu ubicación. Puedes buscar y elegir una dirección.");
    }, { timeout: 8000, maximumAge: 0 });
  }

  return (
    <div className="space-y-3" data-no-page-swipe="true" data-no-pull-to-refresh="true">
      {allowGeolocation && <button type="button" onClick={useMyLocation} disabled={gpsPending}
        className="min-h-11 rounded-full border border-border px-4 text-sm font-medium text-foreground disabled:opacity-60">
        {gpsPending ? "Obteniendo ubicación…" : "Usar mi ubicación"}
      </button>}
      {locationError && <p role="status" className="text-sm text-fg-muted">{locationError}</p>}
      {!mapkit.isReady && <p role="status" className="text-xs text-fg-muted">Preparando búsqueda de ubicaciones…</p>}
      {mapkit.isReady && !mapkit.isAvailable && <p role="status" className="text-sm text-fg-muted">
        No se pudo cargar el buscador. <button type="button" disabled={mapkit.retryWaitSeconds > 0} onClick={mapkit.retry} className="underline">Reintentar</button>
      </p>}
      {/* Search — always visible */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl product-card-btn px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            disabled={!mapkit.isAvailable}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearLocation}
              aria-label="Borrar ubicación"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Searching indicator */}
        {searching && suggestions.length === 0 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl border bg-card shadow-2xl p-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Buscando ubicaciones...
          </div>
        )}

        {/* Empty results indicator */}
        {!searching && hasSearched && suggestions.length === 0 && searchQuery.trim().length >= 3 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl border bg-card shadow-2xl p-4 text-center text-sm text-muted-foreground">
            {outsideMexico
              ? "Ese lugar está fuera de México."
              : outOfCoverage
              ? "Encontramos ese lugar, pero está fuera de la zona donde VICINO opera por ahora."
              : "No se encontraron ubicaciones para esa búsqueda."}
          </div>
        )}

        {/* Results dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl product-card-custom shadow-2xl max-h-60 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="w-full text-left px-4 py-3 text-sm hover:bg-primary/10 transition-colors border-b border-border/20 last:border-0 flex items-start gap-2.5"
              >
                <MapPin className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{s.name}</span>
                    {s.distanceKm !== undefined && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {s.distanceKm < 1 ? "< 1 km" : `${s.distanceKm.toFixed(1)} km`}
                      </span>
                    )}
                  </div>
                  {s.subtitle && (
                    <p className="line-clamp-1 text-xs text-muted-foreground mt-0.5">
                      {s.subtitle}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map + slider — only after selecting a location */}
      {showMap && (
        <>
          <div
            className="rounded-xl overflow-hidden product-card-custom"
            style={{ height: 250 }}
          >
            <AppleMapContainer
              center={position}
              markerPosition={position}
              zoom={14}
              draggableMarker
              onMarkerDragEnd={handleDrag}
              onMapClick={handleDrag}
              radiusKm={onRadiusChange ? radius : undefined}
              height={250}
            />
          </div>

          {onRadiusChange && <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground shrink-0">Radio:</label>
            <input
              type="range"
              min={1}
              max={50}
              value={radius}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRadius(r);
                onRadiusChange?.(r);
              }}
              aria-label="Radio de entrega"
              className="flex-1 accent-[var(--brand)]"
            />
            <span className="text-sm font-medium w-12 text-right">{radius} km</span>
          </div>}

          <button
            type="button"
            onClick={clearLocation}
            className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
          >
            ✕ Quitar ubicación
          </button>
        </>
      )}
    </div>
  );
}
