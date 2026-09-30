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
export function PublicationMap({ initialBounds, focus, features, selected, onBounds, onSelect }: {
  initialBounds: MapBounds; focus: { bounds: MapBounds; revision: number } | null;
  features: MapFeature[]; selected: string | null;
  onBounds: (bounds: MapBounds) => void; onSelect: (feature: MapFeature) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const instance = useRef<MapInstance | null>(null);
  const initial = useRef(initialBounds);
  const callbacks = useRef({ onBounds, onSelect });
  const markers = useRef<Marker[]>([]);
  const { isReady, isAvailable, mapkit, retry, retryWaitSeconds } = useMapKit();
  const { resolvedTheme } = useTheme();
  useEffect(() => { callbacks.current = { onBounds, onSelect }; }, [onBounds, onSelect]);
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
    const brand = node.current ? getComputedStyle(node.current).getPropertyValue("--brand").trim() : "";
    markers.current = features.map(feature => {
      const marker = new mapkit.MarkerAnnotation(new mapkit.Coordinate(feature.public_lat,feature.public_lng), {
        color: selected === feature.id ? "#1c3024" : brand || "#2e7d48", draggable: false, calloutEnabled: false,
        title: `${feature.count} publicaciones · ${feature.seller_count} vendedores · ubicación aproximada`,
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
    <div ref={node} className="h-full w-full" aria-label="Mapa de ubicaciones aproximadas. Las mismas publicaciones están disponibles en la lista." />
    {(!isReady || !isAvailable) && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[color:var(--card)] px-6 text-center text-sm">
      {!isReady ? <><Loader2 className="h-6 w-6 animate-spin" />Cargando mapa…</> : <><MapPin className="h-7 w-7" /><p>No pudimos cargar el mapa. Puedes explorar las publicaciones en la lista.</p><button type="button" disabled={retryWaitSeconds>0} onClick={retry} className="min-h-11 rounded-xl border px-4">{retryWaitSeconds>0 ? `Reintentar en ${retryWaitSeconds} s` : "Reintentar mapa"}</button></>}
    </div>}
  </div>;
}
