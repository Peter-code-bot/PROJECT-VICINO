"use client";

import { useState, useCallback, useEffect, startTransition } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  useEffect(() => {
    const cached = readLocation();
    if (cached) {
      startTransition(() => {
        setState({ status: "success", position: cached });
      });
    }

    const onLocationUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<GeoPosition | null>;
      if (customEvent.detail) {
        startTransition(() => {
          setState({ status: "success", position: customEvent.detail! });
        });
      }
    };

    window.addEventListener("vicino_location_updated", onLocationUpdated);
    return () => {
      window.removeEventListener("vicino_location_updated", onLocationUpdated);
    };
  }, []);

  const request = useCallback(() => {
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
        const cached = readLocation();
        const position: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          radius: cached?.radius ?? 10000,
        };
        writeLocation(position);
        setState({ status: "success", position });
      },
      (err) => {
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

  const setManualPosition = useCallback((pos: { lat: number; lng: number; radius?: number; name?: string; fullName?: string }) => {
    if (
      !Number.isFinite(pos.lat) ||
      !Number.isFinite(pos.lng) ||
      Math.abs(pos.lat) > 90 ||
      Math.abs(pos.lng) > 180
    ) {
      return;
    }
    const cached = readLocation();
    const position: GeoPosition = { 
      lat: pos.lat, 
      lng: pos.lng, 
      radius: pos.radius ?? cached?.radius ?? 10000,
      name: pos.name,
      fullName: pos.fullName
    };
    writeLocation(position);
    setState({ status: "success", position });
  }, []);

  const setRadius = useCallback((radius: number) => {
    setState((prev) => {
      if (prev.status !== "success") return prev;
      const position = { ...prev.position, radius };
      writeLocation(position);
      return { ...prev, position };
    });
    router.refresh();
  }, [router]);

  return { state, request, setManualPosition, setRadius };
}
