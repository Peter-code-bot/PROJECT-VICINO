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
  // Para la geocodificacion inversa del arrastre. La busqueda por texto ya
  // tenia su propio retardo; esta no tenia nada.
  const inversaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inversaAbortRef = useRef<AbortController | null>(null);

  const handleDrag = useCallback(
    (lat: number, lng: number) => {
      setPosition([lat, lng]);

      // La coordenada se entrega YA, sin esperar a Nominatim: es el dato que de
      // verdad importa y no debe depender de un servicio externo. Lo que se
      // retrasa es solo el nombre legible de la calle.
      const provisional = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      onLocationChange(lat, lng, provisional);

      // Dos guardas, por motivos distintos:
      //
      // El retardo respeta la politica de uso de Nominatim, que pide como
      // maximo una peticion por segundo. Arrastrar el marcador varias veces
      // seguidas la superaba con facilidad, y la sancion es el bloqueo de la
      // IP: se quedaria sin buscador de direcciones TODO el mundo, no quien
      // arrastro.
      //
      // El AbortController evita que una respuesta lenta pise a otra
      // posterior. Sin el, arrastrar a A y luego a B podia terminar con la
      // direccion de A sobre las coordenadas de B — y el usuario no tiene
      // forma de notarlo.
      if (inversaRef.current) clearTimeout(inversaRef.current);
      inversaAbortRef.current?.abort();

      inversaRef.current = setTimeout(() => {
        const control = new AbortController();
        inversaAbortRef.current = control;
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
          { signal: control.signal },
        )
          .then((r) => r.json())
          .then((data) => {
            if (control.signal.aborted) return;
            if (data?.display_name) onLocationChange(lat, lng, data.display_name);
          })
          .catch(() => {
            // Si falla o se cancela, se queda la coordenada provisional, que ya
            // es un destino valido. Antes el catch reescribia lo mismo.
          });
      }, 1100);
    },
    [onLocationChange]
  );

  useEffect(() => {
    // Sin esto, un temporizador o una peticion en vuelo sobreviven al desmontaje
    // y llaman a onLocationChange sobre un componente que ya no existe.
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
            <button type="button" onClick={clearLocation} className="text-muted-foreground hover:text-foreground">
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
          <div className="rounded-xl overflow-hidden product-card-custom" style={{ height: 250 }}>
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
