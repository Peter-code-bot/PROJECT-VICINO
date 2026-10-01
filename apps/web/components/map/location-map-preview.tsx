"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { ZoneCard } from "@/components/home/zone-card";
import { mapPreviewCache, emptyMapPreview, clearMapPreviews, type MapPreviewInput } from "@/lib/geo/map-preview-cache";
import type { GeoPosition } from "@/lib/geo/location-storage";

interface Props {
  initialPosition?: { lat: number; lng: number } | null;
  compact?: boolean;
  href?: string;
  viewerScope?: string;
}

/** A static preview of the selected zone; only /mapa creates an interactive map. */
export function LocationMapPreview({ initialPosition = null, href = "/mapa", viewerScope = "guest" }: Props) {
  const initialKey = JSON.stringify(initialPosition);
  const [override, setOverride] = useState<{ source: string; center: Props["initialPosition"] } | null>(null);
  const center = override?.source === initialKey ? override.center : initialPosition;
  const [attempt, setAttempt] = useState(0);
  const lastAttempt = useRef(0);
  const { resolvedTheme } = useTheme();
  const theme: MapPreviewInput["theme"] = resolvedTheme === "dark" ? "dark" : "light";
  const lat = center?.lat, lng = center?.lng;
  const body = useMemo<MapPreviewInput>(() => ({ center: lat !== undefined && lng !== undefined ? { lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)) } : null, theme }), [lat, lng, theme]);
  const key = JSON.stringify([viewerScope, body]);
  const subscribe = useCallback((listener: () => void) => mapPreviewCache.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => mapPreviewCache.snapshot(key), [key]);
  const image = useSyncExternalStore(subscribe, snapshot, emptyMapPreview);
  useEffect(() => {
    const changed = (event: Event) => {
      const position = (event as CustomEvent<GeoPosition | null>).detail;
      clearMapPreviews(); setOverride({ source: initialKey, center: position ? { lat: position.lat, lng: position.lng } : null }); setAttempt(value => value + 1);
    };
    window.addEventListener("vicino_location_updated", changed);
    // Favorites and catalog changes do not change this base-map image.
    return () => { window.removeEventListener("vicino_location_updated", changed); };
  }, [initialKey]);
  useEffect(() => {
    // Wait for theme hydration to avoid a light request followed by a dark one.
    if (!resolvedTheme) return;
    mapPreviewCache.activateContext(viewerScope, theme);
    const force = attempt !== lastAttempt.current;
    lastAttempt.current = attempt;
    void mapPreviewCache.load(key, body, force).catch(() => {});
  }, [key, body, attempt, resolvedTheme, viewerScope, theme]);

  const unavailable = image.status === "error" || image.status === "expired";
  return (
    <section aria-label={center ? "Vista previa de tu zona" : "Vista previa de México"} className="relative">
      <Link href={href} prefetch={false} aria-label="Ver publicaciones en el mapa"
        className="relative block aspect-video w-full rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--fg)]">
        {/* Keep the provider's complete 16:9 image, including its attribution. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image.url ? <img src={image.url} alt={center ? "Mapa de la ubicación elegida" : "Mapa de México"} width={640} height={360} className="block h-auto w-full rounded-3xl" /> : (
          <div className="absolute inset-0 rounded-3xl bg-[color:var(--card-2)] text-[color:var(--fg)]">
            <p role="status" className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm">
            {unavailable ? "Vista previa no disponible" : center ? "Cargando tu zona…" : "México"}
            </p>
          </div>
        )}
      </Link>
      <div className="absolute left-3 top-3"><ZoneCard hayUbicacionEnServidor={!!center} positionOverride={center ?? null} resolveName={false} /></div>
      {unavailable && <button type="button" onClick={() => setAttempt(value => value + 1)} className="discovery-control absolute right-3 bottom-3 px-4 text-sm">Reintentar</button>}
    </section>
  );
}
