"use client";

import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

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
  return (
    <div className="relative mx-5 h-[200px] overflow-hidden rounded-2xl">
      <MapContainer
        key={`${lat.toFixed(4)}-${lng.toFixed(4)}`}
        center={[lat, lng]}
        zoom={14}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        dragging={false}
        touchZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={[lat, lng]} icon={icon} />
      </MapContainer>

      {zoneLabel && (
        <div className="absolute bottom-3 left-3 z-[1000] rounded-xl bg-[color:var(--bg)]/80 px-2.5 py-1 font-heading text-sm font-semibold text-[color:var(--fg)] backdrop-blur-sm">
          {zoneLabel}
        </div>
      )}
      {cityLabel && (
        <div className="absolute top-3 right-3 z-[1000] rounded-xl bg-[color:var(--bg)]/80 px-2.5 py-1 text-xs text-[color:var(--fg-muted)] backdrop-blur-sm">
          {cityLabel}
        </div>
      )}
    </div>
  );
}
