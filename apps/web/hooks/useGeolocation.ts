"use client";

import { useState, useCallback, useEffect, startTransition } from "react";
import { useRouter } from "next/navigation";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  radius?: number;
  name?: string;
  fullName?: string;
}

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; position: GeoPosition }
  | { status: "error"; message: string };

const STORAGE_KEY = "vicino_last_location";

function readCache(): GeoPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GeoPosition;
  } catch {
    return null;
  }
}

function writeCache(pos: GeoPosition) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    if (typeof document !== "undefined") {
      const lat3 = pos.lat.toFixed(3);
      const lng3 = pos.lng.toFixed(3);
      document.cookie = `vicino_location=${lat3},${lng3}; path=/; max-age=31536000; SameSite=Lax`;
      if (pos.radius) {
        document.cookie = `vicino_radius=${pos.radius}; path=/; max-age=31536000; SameSite=Lax`;
      }
    }
  } catch {
    // quota exceeded o modo privado — ignorar
  }
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });

  const router = useRouter();

  useEffect(() => {
    // Mover la lectura del caché a useEffect evita el "React Hydration Error" 
    // porque el primer render coincidirá siempre con el servidor (idle).
    const cached = readCache();
    if (cached) {
      const lat3 = cached.lat.toFixed(3);
      const lng3 = cached.lng.toFixed(3);
      const expectedCookieVal = `${lat3},${lng3}`;
      const cookies = document.cookie.split("; ");
      const locationCookie = cookies.find((c) => c.startsWith("vicino_location="));
      const hasCorrectCookie = locationCookie === `vicino_location=${expectedCookieVal}`;
      
      const expectedRadius = cached.radius ? `${cached.radius}` : "2000";
      const radiusCookie = cookies.find((c) => c.startsWith("vicino_radius="));
      const hasCorrectRadius = radiusCookie === `vicino_radius=${expectedRadius}`;

      if (!hasCorrectCookie || (!hasCorrectRadius && cached.radius)) {
        writeCache(cached);
        let synced = false;
        try {
          synced = sessionStorage.getItem("vicino_geo_synced") === "1";
        } catch (e) {
          console.warn("Storage access restricted by browser privacy settings");
          synced = true;
        }
        if (!synced) {
          try {
            sessionStorage.setItem("vicino_geo_synced", "1");
          } catch (e) {
            console.warn("Storage access restricted by browser privacy settings");
          }
          router.refresh();
        }
      }

      startTransition(() => {
        setState({ status: "success", position: cached });
      });
    }
  }, [router]);

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
        const cached = readCache();
        const position: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          radius: cached?.radius ?? 2000,
        };
        writeCache(position);
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
      // Rechazo silencioso — el caller pasó coords inválidas, no contaminamos
      // el caché. La app sigue con la posición anterior.
      return;
    }
    const cached = readCache();
    const position: GeoPosition = { 
      lat: pos.lat, 
      lng: pos.lng, 
      radius: pos.radius ?? cached?.radius ?? 2000,
      name: pos.name,
      fullName: pos.fullName
    };
    writeCache(position);
    setState({ status: "success", position });
  }, []);

  const setRadius = useCallback((radius: number) => {
    setState((prev) => {
      if (prev.status !== "success") return prev;
      const position = { ...prev.position, radius };
      writeCache(position);
      return { ...prev, position };
    });
    router.refresh();
  }, [router]);

  return { state, request, setManualPosition, setRadius };
}
