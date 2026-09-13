"use client";

import { MapContainer, TileLayer, Circle, useMapEvents } from "react-leaflet";
import { MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";

interface Props {
  /** Punto inicial del centro del mapa. */
  lat: number;
  lng: number;
  /** Centro de fundacion: dibuja el circulo del radio permitido. */
  fundacion: { lat: number; lng: number };
  radioMetros: number;
  onMove: (lat: number, lng: number) => void;
}

function Seguidor({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    moveend: (e) => {
      const c = e.target.getCenter();
      onMove(c.lat, c.lng);
    },
  });
  return null;
}

/**
 * Mapa arrastrable para mover el centro (decision 6). El pin es un icono
 * fijo en el centro del contenedor (no un Marker de Leaflet: asi no se queda
 * atras mientras se arrastra) y el circulo pinta el kilometro permitido
 * desde el punto de fundacion. Se importa con next/dynamic y ssr:false.
 */
export default function CentroMap({ lat, lng, fundacion, radioMetros, onMove }: Props) {
  return (
    <div className="relative h-[240px] overflow-hidden rounded-2xl">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Circle
          center={[fundacion.lat, fundacion.lng]}
          radius={radioMetros}
          pathOptions={{ color: "#2E8773", fillColor: "#2E8773", fillOpacity: 0.08, weight: 1.5 }}
        />
        <Seguidor onMove={onMove} />
      </MapContainer>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-full">
        <MapPin className="h-9 w-9 fill-[color:var(--brand)] text-white drop-shadow-md" strokeWidth={1.5} />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-xl bg-[color:var(--bg)]/85 px-2.5 py-1 text-xs text-[color:var(--fg-muted)] backdrop-blur-sm">
        Arrastra el mapa para mover el centro
      </div>
    </div>
  );
}
