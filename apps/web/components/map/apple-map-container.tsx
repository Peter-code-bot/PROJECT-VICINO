"use client";

import { useEffect, useRef } from "react";
import { useMapKit, type MapKitGlobal } from "@/hooks/use-mapkit";
import { useTheme } from "next-themes";
import { Loader2, RotateCw } from "lucide-react";

interface AppleMapProps {
  center: [number, number]; // [lat, lng]
  zoom?: number;
  interactive?: boolean;
  markerPosition?: [number, number] | null;
  draggableMarker?: boolean;
  onMarkerDragEnd?: (lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
  radiusKm?: number;
  circleCenter?: [number, number];
  circleColor?: string;
  height?: string | number;
  className?: string;
}

type MapInstance = InstanceType<MapKitGlobal["Map"]>;
type MarkerInstance = InstanceType<MapKitGlobal["MarkerAnnotation"]>;

export default function AppleMapContainer({
  center,
  zoom = 14,
  interactive = true,
  markerPosition,
  draggableMarker = false,
  onMarkerDragEnd,
  onMapClick,
  radiusKm,
  circleCenter,
  circleColor,
  height = "100%",
  className = "",
}: AppleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapInstance | null>(null);
  const markerRef = useRef<MarkerInstance | null>(null);
  const circleRef = useRef<unknown>(null);
  const { isReady, isAvailable, mapkit, retry } = useMapKit();
  const { resolvedTheme } = useTheme();

  const onMapClickRef = useRef(onMapClick);
  const onMarkerDragEndRef = useRef(onMarkerDragEnd);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onMarkerDragEndRef.current = onMarkerDragEnd;
  }, [onMarkerDragEnd]);

  const centerLat = center[0];
  const centerLng = center[1];
  const markerLat = markerPosition ? markerPosition[0] : centerLat;
  const markerLng = markerPosition ? markerPosition[1] : centerLng;

  // Inicializar o actualizar mapa de Apple MapKit
  useEffect(() => {
    if (!isReady || !isAvailable || !mapkit || !containerRef.current) return;

    const centerCoord = new mapkit.Coordinate(centerLat, centerLng);

    // Calcular span según zoom aproximado
    const delta = Math.max(0.005, 360 / Math.pow(2, zoom));
    const region = new mapkit.CoordinateRegion(
      centerCoord,
      new mapkit.CoordinateSpan(delta, delta)
    );

    // Crear mapa si no existe
    if (!mapInstanceRef.current) {
      const map = new mapkit.Map(containerRef.current, {
        region,
        colorScheme:
          resolvedTheme === "dark"
            ? mapkit.Map.ColorSchemes.Dark
            : mapkit.Map.ColorSchemes.Light,
        isScrollEnabled: interactive,
        isZoomEnabled: interactive,
        isRotationEnabled: interactive,
        showsCompass: interactive
          ? mapkit.FeatureVisibility.Adaptive
          : mapkit.FeatureVisibility.Hidden,
        showsMapTypeControl: false,
        showsZoomControl: false,
        showsUserLocation: true,
      });

      mapInstanceRef.current = map;

      // Evento clic en mapa
      if (interactive) {
        map.addEventListener("single-tap", (e: { pointOnPage?: { x: number; y: number } }) => {
          if (e.pointOnPage && onMapClickRef.current) {
            try {
              const domPoint = new DOMPoint(e.pointOnPage.x, e.pointOnPage.y);
              const coord = map.convertPointOnPageToCoordinate(domPoint);
              onMapClickRef.current(coord.latitude, coord.longitude);
            } catch {
              // fallback silencioso
            }
          }
        });
      }
    } else {
      mapInstanceRef.current.setRegionAnimated(region, true);
      mapInstanceRef.current.colorScheme =
        resolvedTheme === "dark"
          ? mapkit.Map.ColorSchemes.Dark
          : mapkit.Map.ColorSchemes.Light;
    }

    const map = mapInstanceRef.current;

    // Actualizar Marker
    if (markerRef.current) {
      map.removeAnnotation(markerRef.current);
      markerRef.current = null;
    }

    const markerCoord = new mapkit.Coordinate(markerLat, markerLng);
    const marker = new mapkit.MarkerAnnotation(markerCoord, {
      color: "#1F5A4E",
      title: "Ubicación",
      draggable: draggableMarker && interactive,
    });

    if (draggableMarker) {
      marker.addEventListener("drag-end", () => {
        const c = marker.coordinate;
        onMarkerDragEndRef.current?.(c.latitude, c.longitude);
      });
    }

    map.addAnnotation(marker);
    markerRef.current = marker;

    // Actualizar círculo de radio (delivery radius)
    if (circleRef.current) {
      map.removeOverlay(circleRef.current);
      circleRef.current = null;
    }

    if (radiusKm && radiusKm > 0) {
      const circleLat = circleCenter ? circleCenter[0] : markerLat;
      const circleLng = circleCenter ? circleCenter[1] : markerLng;
      const circleCoord = new mapkit.Coordinate(circleLat, circleLng);
      const stroke = circleColor || "#E8734A";
      const circle = new mapkit.CircleOverlay(circleCoord, radiusKm * 1000, {
        style: new mapkit.Style({
          fillColor: stroke,
          fillOpacity: 0.18,
          strokeColor: stroke,
          lineWidth: 2,
          lineDash: [6, 4],
        }),
      });
      map.addOverlay(circle);
      circleRef.current = circle;
    }
  }, [
    isReady,
    isAvailable,
    mapkit,
    centerLat,
    centerLng,
    markerLat,
    markerLng,
    zoom,
    interactive,
    draggableMarker,
    radiusKm,
    circleCenter,
    circleColor,
    resolvedTheme,
  ]);

  // Destruir mapa al desmontar el componente
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.destroy();
        } catch {
          // ignore
        }
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Mientras carga la disponibilidad
  if (!isReady) {
    return (
      <div
        className={`flex items-center justify-center bg-[color:var(--card-2)] rounded-2xl ${className}`}
        style={{ height }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
      </div>
    );
  }

  // Si MapKit está disponible, montamos el div donde Apple MapKit se inicializa
  if (isAvailable) {
    return (
      <div
        ref={containerRef}
        data-mapkit="true"
        className={`relative overflow-hidden rounded-2xl ${className}`}
        style={{ height, width: "100%" }}
      />
    );
  }

  // Fallback si el mapa no pudo inicializar o no hay red (P1-4, P1-5)
  return (
    <div
      className={`relative flex flex-col items-center justify-center bg-[color:var(--card-2)] p-4 text-center text-xs text-[color:var(--fg-muted)] rounded-2xl ${className}`}
      style={{ height }}
    >
      <div className="flex items-center gap-1.5 mb-1 font-semibold text-[color:var(--fg)]">
        <span>📍</span>
        <span>
          {centerLat.toFixed(4)}, {centerLng.toFixed(4)}
        </span>
      </div>
      <p className="max-w-[280px] text-[color:var(--fg-dim)] mb-2.5">
        El mapa interactivo no está disponible temporalmente. Puedes continuar buscando o escribiendo tu zona.
      </p>
      <button
        type="button"
        onClick={retry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[color:var(--brand)] text-white font-medium text-xs hover:opacity-90 active:scale-95 transition-transform shadow-sm"
      >
        <RotateCw className="h-3 w-3" />
        Reintentar cargar mapa
      </button>
    </div>
  );
}
