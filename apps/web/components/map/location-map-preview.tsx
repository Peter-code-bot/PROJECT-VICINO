"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { ZoneCard } from "@/components/home/zone-card";
import { mapPreviewCache, emptyMapPreview, clearMapPreviews, type MapPreviewInput } from "@/lib/geo/map-preview-cache";
import type { GeoPosition } from "@/lib/geo/location-storage";

interface Props {
  initialPosition?: { lat: number; lng: number } | null;
  compact?: boolean;
  href?: string;
  viewerScope?: string;
}

/** Home and Search share a static image; only /mapa creates an interactive map. */
export function LocationMapPreview({ initialPosition = null, compact = false, href = "/mapa", viewerScope = "guest" }: Props) {
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
    <section aria-label={center ? "Vista previa de tu zona" : "Vista previa de México"} className="relative overflow-hidden rounded-3xl product-card-custom">
      <div className={compact ? "h-[180px] sm:h-[200px]" : "h-[250px] sm:h-[320px]"}>
        {/* Contain the full provider image; its attribution must remain visible. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image.url ? <img src={image.url} alt={center ? "Mapa de la ubicación elegida" : "Mapa de México"} width={640} height={360} className="h-full w-full object-contain" /> : (
          <div role="status" className="flex h-full flex-col items-center justify-center gap-2 px-6 pt-12 pb-12 text-center text-sm product-card-text">
            <MapPin className="h-6 w-6" />
            {unavailable ? "Vista previa no disponible" : center ? "Cargando tu zona…" : "México"}
            {unavailable && <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 underline">Reintentar</button>}
          </div>
        )}
      </div>
      <div className="absolute left-3 top-3"><ZoneCard hayUbicacionEnServidor={!!center} positionOverride={center ?? null} resolveName={false} /></div>
      <div className="flex justify-end px-3 pt-2 pb-3">
        <Link href={href} className="flex min-h-11 items-center gap-2 rounded-2xl bg-[color:var(--sidebar-bg)] px-3 text-xs font-semibold text-[color:var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-2">Ver publicaciones en el mapa<ArrowRight className="h-4 w-4" /></Link>
      </div>
    </section>
  );
}
