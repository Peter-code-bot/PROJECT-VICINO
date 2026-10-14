"use client";

import { useState, useCallback, useEffect, useRef, startTransition } from "react";

import {
  readLocation,
  writeLocation,
  STORAGE_KEY,
  type GeoPosition,
} from "@/lib/geo/location-storage";

export { STORAGE_KEY };
export type { GeoPosition };

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; position: GeoPosition }
  | { status: "error"; message: string };

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const generation = useRef(0);

  useEffect(() => {
    const cached = readLocation();
    if (cached) {
      startTransition(() => {
        setState({ status: "success", position: cached });
      });
    }

    const onLocationUpdated = (e: Event) => {
      generation.current++;
      const customEvent = e as CustomEvent<GeoPosition | null>;
      if (customEvent.detail) {
        startTransition(() => {
          setState({ status: "success", position: customEvent.detail! });
        });
      } else {
        startTransition(() => setState({ status: "idle" }));
      }
    };

    const onLabelUpdated = (event: Event) => {
      const position = (event as CustomEvent<GeoPosition>).detail;
      setState(previous => previous.status === "success"
        && previous.position.lat.toFixed(3) === position.lat.toFixed(3)
        && previous.position.lng.toFixed(3) === position.lng.toFixed(3)
        ? { status: "success", position: { ...previous.position, name: position.name, fullName: position.fullName } }
        : previous);
    };

    window.addEventListener("vicino_location_updated", onLocationUpdated);
    window.addEventListener("vicino_location_label_updated", onLabelUpdated);
    return () => {
      // This is a request generation counter, deliberately invalidated at unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      window.removeEventListener("vicino_location_updated", onLocationUpdated);
      window.removeEventListener("vicino_location_label_updated", onLabelUpdated);
    };
  }, []);

  const request = useCallback(() => {
    const sequence = ++generation.current;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", message: "Geolocalización no disponible en este dispositivo" });
      return;
    }
    // Solo mostrar loading si aún no tenemos posición
    setState((prev) =>
      prev.status === "success" ? prev : { status: "loading" }
    );
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (sequence !== generation.current) return;
        const cached = readLocation();
        const position: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          radius: cached?.radius ?? 10000,
        };
        if (writeLocation(position)) setState({ status: "success", position: { ...position, lat: Number(position.lat.toFixed(3)), lng: Number(position.lng.toFixed(3)) } });
        else setState((prev) => prev.status === "success" ? prev : { status: "error", message: "No se pudo guardar la ubicación. Intenta de nuevo." });
      },
      (err) => {
        if (sequence !== generation.current) return;
        const message =
          err.code === 1
            ? "Permiso de ubicación denegado"
            : err.code === 2
              ? "Ubicación no disponible"
              : "Tiempo de espera agotado";
        setState({ status: "error", message });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }
    );
  }, []);

  const setManualPosition = useCallback((pos: GeoPosition) => {
    generation.current++;
    if (
      !Number.isFinite(pos.lat) ||
      !Number.isFinite(pos.lng) ||
      Math.abs(pos.lat) > 90 ||
      Math.abs(pos.lng) > 180
    ) {
      return false;
    }
    const cached = readLocation();
    const position: GeoPosition = { 
      lat: pos.lat, 
      lng: pos.lng, 
      radius: pos.radius ?? cached?.radius ?? 10000,
      name: pos.name,
      fullName: pos.fullName,
      accuracy: pos.accuracy,
    };
    if (!writeLocation(position)) return false;
    setState({ status: "success", position: { ...position, lat: Number(position.lat.toFixed(3)), lng: Number(position.lng.toFixed(3)) } });
    return true;
  }, []);

  const setRadius = useCallback((radius: number) => {
    const current = readLocation();
    return current ? setManualPosition({ ...current, radius }) : false;
  }, [setManualPosition]);

  return { state, request, setManualPosition, setRadius };
}
