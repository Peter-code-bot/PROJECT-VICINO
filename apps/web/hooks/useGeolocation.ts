"use client";

import { useState, useCallback, useEffect } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy?: number;
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
  } catch {
    // quota exceeded o modo privado — ignorar
  }
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });

  useEffect(() => {
    // Mover la lectura del caché a useEffect evita el "React Hydration Error" 
    // porque el primer render coincidirá siempre con el servidor (idle).
    const cached = readCache();
    if (cached) {
      setState({ status: "success", position: cached });
    }
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
        const position: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
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

  return { state, request };
}
