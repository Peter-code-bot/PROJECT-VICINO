"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Loader2, MapPin } from "lucide-react";
import { useMapKit, type MapKitGlobal } from "@/hooks/use-mapkit";
import type { MapBounds, MapFeature } from "@vicino/shared";

type MapInstance = InstanceType<MapKitGlobal["Map"]>;
type Marker = InstanceType<MapKitGlobal["MarkerAnnotation"]>;
function region(sdk: MapKitGlobal, b: MapBounds) {
  return new sdk.CoordinateRegion(new sdk.Coordinate((b.north+b.south)/2,(b.east+b.west)/2),
    new sdk.CoordinateSpan(Math.max(0.015,b.north-b.south),Math.max(0.015,b.east-b.west)));
}
export function PublicationMap({ initialBounds, focus, features, selected, onBounds, onSelect, onAvailabilityChange }: {
  initialBounds: MapBounds; focus: { bounds: MapBounds; revision: number } | null;
  features: MapFeature[]; selected: string | null;
  onBounds: (bounds: MapBounds) => void; onSelect: (feature: MapFeature) => void;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const instance = useRef<MapInstance | null>(null);
  const initial = useRef(initialBounds);
  const callbacks = useRef({ onBounds, onSelect, onAvailabilityChange });
  const markers = useRef<Marker[]>([]);
  const { isReady, isAvailable, mapkit, retry, retryWaitSeconds } = useMapKit();
  const { resolvedTheme } = useTheme();
  useEffect(() => { callbacks.current = { onBounds, onSelect, onAvailabilityChange }; }, [onBounds, onSelect, onAvailabilityChange]);
  useEffect(() => { if (isReady) callbacks.current.onAvailabilityChange?.(isAvailable); }, [isReady, isAvailable]);
  useEffect(() => {
    if (!isReady || !isAvailable || !mapkit || !node.current) return;
    const map = new mapkit.Map(node.current, { region: region(mapkit, initial.current), showsUserLocation: false,
      showsMapTypeControl: false, showsCompass: mapkit.FeatureVisibility.Adaptive, showsZoomControl: true });
    instance.current = map;
    const reportBounds = () => {
      const r = map.region;
      if (!r) return;
      const round = (v: number) => Math.round(v*1e6)/1e6;
      callbacks.current.onBounds({ west: round(r.center.longitude-r.span.longitudeDelta/2), east: round(r.center.longitude+r.span.longitudeDelta/2),
        south: round(r.center.latitude-r.span.latitudeDelta/2), north: round(r.center.latitude+r.span.latitudeDelta/2) });
    };
    map.addEventListener("region-change-end", reportBounds);
    // MapKit can adapt the initial span to the element's aspect ratio.
    reportBounds();
    return () => { instance.current = null; markers.current = []; map.destroy(); };
  }, [isReady, isAvailable, mapkit]);
  useEffect(() => {
    if (instance.current && mapkit) instance.current.colorScheme = resolvedTheme === "dark" ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light;
  }, [resolvedTheme, isReady, mapkit]);
  useEffect(() => {
    const map = instance.current;
    if (!map || !mapkit) return;
    for (const marker of markers.current) map.removeAnnotation(marker);
    const style = node.current ? getComputedStyle(node.current) : null;
    const brand = style?.getPropertyValue("--brand").trim();
    const active = style?.getPropertyValue("--discovery-selected-bg").trim();
    markers.current = features.map(feature => {
      const label = `${feature.count} ${feature.count === 1 ? "publicación" : "publicaciones"}${feature.seller_count > 0 ? ` · ${feature.seller_count} ${feature.seller_count === 1 ? "vendedor" : "vendedores"}` : ""} · ubicación aproximada${selected === feature.id ? " · seleccionado" : ""}`;
      const marker = new mapkit.MarkerAnnotation(new mapkit.Coordinate(feature.public_lat,feature.public_lng), {
        color: selected === feature.id ? active : brand, draggable: false, calloutEnabled: false,
        title: label, accessibilityLabel: label, titleVisibility: mapkit.FeatureVisibility.Hidden,
        glyphText: feature.count > 99 ? "99+" : String(feature.count),
      });
      marker.addEventListener("select", () => callbacks.current.onSelect(feature));
      map.addAnnotation(marker);
      return marker;
    });
    return () => { for (const marker of markers.current) map.removeAnnotation(marker); markers.current = []; };
  }, [features, selected, resolvedTheme, isReady, mapkit]);
  useEffect(() => {
    if (focus && instance.current && mapkit) instance.current.setRegionAnimated(region(mapkit,focus.bounds),true);
  }, [focus, isReady, mapkit]);
  return <div className="relative h-full min-h-[280px] overflow-hidden rounded-3xl bg-[color:var(--card-2)]" data-no-page-swipe data-no-pull-to-refresh>
    <div ref={node} className="h-full w-full" aria-label="Mapa de ubicaciones aproximadas. Toca un punto para ver sus publicaciones o usa la lista de puntos accesible." />
    {(!isReady || !isAvailable) && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[color:var(--sidebar-bg)] px-6 text-center text-sm">
      {!isReady ? <><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />Cargando mapa…</> : <><MapPin className="h-7 w-7" /><p>No pudimos cargar el mapa. Puedes usar la búsqueda o la lista de puntos.</p><button type="button" disabled={retryWaitSeconds>0} onClick={retry} className="discovery-control">{retryWaitSeconds>0 ? `Reintentar en ${retryWaitSeconds} s` : "Reintentar mapa"}</button></>}
    </div>}
  </div>;
}
