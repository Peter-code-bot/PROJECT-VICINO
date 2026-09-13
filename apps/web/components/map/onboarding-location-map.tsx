"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Search, LocateFixed, Loader2, MapPin, X } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";

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
  const [suggestions, setSuggestions] = useState<
    Array<{ display_name: string; lat: string; lon: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [requestingGps, setRequestingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reverse geocoding diferido al arrastrar o tocar
  const handlePositionChange = useCallback(
    (lat: number, lng: number) => {
      setPosition([lat, lng]);
      const provisional = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      commitPosition(lat, lng, provisional);

      if (reverseRef.current) clearTimeout(reverseRef.current);
      reverseRef.current = setTimeout(() => {
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
        )
          .then((r) => r.json())
          .then((data) => {
            if (data?.display_name) {
              const parts = data.display_name.split(",").map((s: string) => s.trim());
              const shortName = parts.slice(0, 2).join(", ");
              commitPosition(lat, lng, shortName || data.display_name);
            }
          })
          .catch(() => {});
      }, 1000);
    },
    [commitPosition]
  );

  // Buscador de direcciones
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          q
        )}&format=json&countrycodes=mx&limit=5`
      )
        .then((r) => r.json())
        .then((data) => {
          setSuggestions(Array.isArray(data) ? data : []);
          setSearching(false);
        })
        .catch(() => {
          setSuggestions([]);
          setSearching(false);
        });
    }, 500);
  };

  const selectSuggestion = (s: { display_name: string; lat: string; lon: string }) => {
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lon);
    const parts = s.display_name.split(",").map((p) => p.trim());
    const shortLabel = parts.slice(0, 2).join(", ");
    setSearchQuery(shortLabel);
    setSuggestions([]);
    commitPosition(lat, lng, shortLabel);
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

        {/* Dropdown sugerencias */}
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-[60] mt-1.5 overflow-hidden rounded-2xl bg-[color:var(--card-2)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] border border-[color:var(--border)] max-h-56 overflow-y-auto">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-xs text-[color:var(--fg)] hover:bg-[color:var(--card)] border-b border-[color:var(--border)]/40 last:border-0"
              >
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[color:var(--brand)]" />
                <span className="line-clamp-2">{s.display_name}</span>
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
