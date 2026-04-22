"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, MapPin, Loader2, X } from "lucide-react";

const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface DeliveryMapProps {
  onLocationChange: (lat: number, lng: number, address: string) => void;
  onRadiusChange: (km: number) => void;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
}

function DraggableMarker({
  position,
  onDragEnd,
}: {
  position: [number, number];
  onDragEnd: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  useMapEvents({
    click(e) {
      onDragEnd(e.latlng.lat, e.latlng.lng);
    },
  });
  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable
      eventHandlers={{
        dragend: () => {
          const m = markerRef.current;
          if (m) {
            const pos = m.getLatLng();
            onDragEnd(pos.lat, pos.lng);
          }
        },
      }}
    />
  );
}

function RecenterMap({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, 14);
  }, [map, position]);
  return null;
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
  const [suggestions, setSuggestions] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [showMap, setShowMap] = useState(hasInitial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDrag = useCallback(
    (lat: number, lng: number) => {
      setPosition([lat, lng]);
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`)
        .then((r) => r.json())
        .then((data) => onLocationChange(lat, lng, data.display_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`))
        .catch(() => onLocationChange(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`));
    },
    [onLocationChange]
  );

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
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=mx&limit=5`)
        .then((r) => r.json())
        .then((data) => { setSuggestions(data); setSearching(false); })
        .catch(() => { setSuggestions([]); setSearching(false); });
    }, 500);
  }

  function selectSuggestion(s: { display_name: string; lat: string; lon: string }) {
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lon);
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
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Busca tu zona de entrega..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button type="button" onClick={clearLocation} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Searching indicator */}
        {searching && suggestions.length === 0 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl border bg-white dark:bg-neutral-900 shadow-2xl p-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Buscando ubicaciones...
          </div>
        )}

        {/* Results dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl border bg-white dark:bg-neutral-900 shadow-2xl max-h-60 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="w-full text-left px-4 py-3 text-sm hover:bg-bone/10 transition-colors border-b border-border/20 last:border-0 flex items-start gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-bone mt-0.5 shrink-0" />
                <span>{s.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map + slider — only after selecting a location */}
      {showMap && (
        <>
          <div className="rounded-xl overflow-hidden border border-border/50" style={{ height: 250 }}>
            <MapContainer
              center={position}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <RecenterMap position={position} />
              <DraggableMarker position={position} onDragEnd={handleDrag} />
              <Circle
                center={position}
                radius={radius * 1000}
                pathOptions={{
                  color: "#E8734A",
                  fillColor: "#E8734A",
                  fillOpacity: 0.2,
                  weight: 3,
                  dashArray: "8, 6",
                }}
              />
            </MapContainer>
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
