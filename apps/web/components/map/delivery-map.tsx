"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Search, MapPin, Loader2, X } from "lucide-react";

const AppleMapContainer = dynamic(() => import("./apple-map-container"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[250px] items-center justify-center rounded-xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
    </div>
  ),
});

interface DeliveryMapProps {
  onLocationChange: (lat: number, lng: number, address: string) => void;
  onRadiusChange: (km: number) => void;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
}

export default function DeliveryMap({
  onLocationChange,
  onRadiusChange,
  initialLat,
  initialLng,
  initialRadius = 5,
}: DeliveryMapProps) {
  const hasInitial = !!(initialLat && initialLng);
  const [position, setPosition] = useState<[number, number]>(
    hasInitial ? [initialLat, initialLng] : [19.0414, -98.2063]
  );
  const [radius, setRadius] = useState(initialRadius);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ display_name: string; lat: string; lon: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [showMap, setShowMap] = useState(hasInitial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inversaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inversaAbortRef = useRef<AbortController | null>(null);

  const handleDrag = useCallback(
    (lat: number, lng: number) => {
      setPosition([lat, lng]);

      const provisional = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      onLocationChange(lat, lng, provisional);

      if (inversaRef.current) clearTimeout(inversaRef.current);
      inversaAbortRef.current?.abort();

      inversaRef.current = setTimeout(() => {
        const control = new AbortController();
        inversaAbortRef.current = control;
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
          { signal: control.signal }
        )
          .then((r) => r.json())
          .then((data) => {
            if (control.signal.aborted) return;
            if (data?.display_name) onLocationChange(lat, lng, data.display_name);
          })
          .catch(() => {});
      }, 1100);
    },
    [onLocationChange]
  );

  useEffect(() => {
    return () => {
      if (inversaRef.current) clearTimeout(inversaRef.current);
      inversaAbortRef.current?.abort();
    };
  }, []);

  function handleSearch(q: string) {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) {
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
  }

  function selectSuggestion(s: { display_name: string; lat: string; lon: string }) {
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lon);
    // Nominatim es un tercero: si devuelve algo que no es un numero, el NaN
    // acaba en mapkit.Coordinate y ademas se guardaria como ubicacion. Mismo
    // criterio que change-location-sheet.tsx:268.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setPosition([lat, lng]);
    setSearchQuery(s.display_name.split(",")[0] ?? s.display_name);
    setSuggestions([]);
    setShowMap(true);
    onLocationChange(lat, lng, s.display_name);
  }

  function clearLocation() {
    setShowMap(false);
    setSearchQuery("");
    setSuggestions([]);
    onLocationChange(0, 0, "");
  }

  return (
    <div className="space-y-3">
      {/* Search — always visible */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl product-card-btn px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Busca tu zona de entrega..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearLocation}
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

        {/* Results dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl product-card-custom shadow-2xl max-h-60 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="w-full text-left px-4 py-3 text-sm hover:bg-primary/10 transition-colors border-b border-border/20 last:border-0 flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span>{s.display_name}</span>
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
              radiusKm={radius}
              height={250}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground shrink-0">Radio:</label>
            <input
              type="range"
              min={1}
              max={50}
              value={radius}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRadius(r);
                onRadiusChange(r);
              }}
              className="flex-1 accent-[#E8734A]"
            />
            <span className="text-sm font-medium w-12 text-right">{radius} km</span>
          </div>

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
