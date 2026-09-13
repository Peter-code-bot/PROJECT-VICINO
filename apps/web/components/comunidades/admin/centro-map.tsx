"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const AppleMapContainer = dynamic(() => import("@/components/map/apple-map-container"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[240px] items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
    </div>
  ),
});

interface Props {
  /** Punto inicial del centro del mapa. */
  lat: number;
  lng: number;
  /** Centro de fundacion: dibuja el circulo del radio permitido. */
  fundacion: { lat: number; lng: number };
  radioMetros: number;
  onMove: (lat: number, lng: number) => void;
}

/**
 * Mapa interactivo para mover el centro de la comunidad (Decisión 3).
 * Utiliza AppleMapContainer unificado con pin arrastrable y círculo de radio.
 */
export default function CentroMap({ lat, lng, fundacion, radioMetros, onMove }: Props) {
  const radiusKm = radioMetros / 1000;

  return (
    <div className="relative h-[240px] overflow-hidden rounded-2xl">
      <AppleMapContainer
        center={[lat, lng]}
        markerPosition={[lat, lng]}
        draggableMarker
        onMarkerDragEnd={onMove}
        onMapClick={onMove}
        radiusKm={radiusKm}
        circleCenter={[fundacion.lat, fundacion.lng]}
        circleColor="#2E8773"
        height={240}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-xl bg-[color:var(--bg)]/85 px-2.5 py-1 text-xs text-[color:var(--fg-muted)] backdrop-blur-sm">
        Arrastra o toca el mapa para mover el centro
      </div>
    </div>
  );
}
