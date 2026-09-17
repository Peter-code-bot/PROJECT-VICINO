"use client";

import AppleMapContainer from "@/components/map/apple-map-container";

interface Props {
  lat: number;
  lng: number;
  zoneLabel?: string | null;
  cityLabel?: string | null;
}

export default function ChangeLocationMap({
  lat,
  lng,
  zoneLabel,
  cityLabel,
}: Props) {
  // Los dos atributos van en el recuadro entero, no solo en el lienzo de
  // MapKit: cubren tambien las etiquetas de zona y ciudad y el hueco de carga.
  // Sin ellos, un arrastre horizontal que empiece ahi cambia de pestana y uno
  // vertical dispara el pull-to-refresh en vez de mover el mapa.
  return (
    <div
      data-no-page-swipe="true"
      data-no-pull-to-refresh="true"
      className="relative mx-5 h-[200px] overflow-hidden rounded-2xl border border-[color:var(--border)]"
    >
      <AppleMapContainer
        key={`${lat.toFixed(4)}-${lng.toFixed(4)}`}
        center={[lat, lng]}
        markerPosition={[lat, lng]}
        zoom={14}
        height="100%"
      />

      {zoneLabel && (
        <div className="absolute bottom-3 left-3 z-[10] rounded-xl bg-[color:var(--bg)]/85 px-2.5 py-1 font-heading text-sm font-semibold text-[color:var(--fg)] backdrop-blur-sm border border-[color:var(--border)]/70 shadow-sm">
          {zoneLabel}
        </div>
      )}
      {cityLabel && (
        <div className="absolute top-3 right-3 z-[10] rounded-xl bg-[color:var(--bg)]/85 px-2.5 py-1 text-xs text-[color:var(--fg-muted)] backdrop-blur-sm border border-[color:var(--border)]/70 shadow-sm">
          {cityLabel}
        </div>
      )}
    </div>
  );
}
