"use client";

import { useState, useEffect } from "react";

export interface MapKitGlobal {
  init: (options: {
    authorizationCallback: (done: (token: string) => void) => void;
    language?: string;
  }) => void;
  Map: {
    ColorSchemes: {
      Dark: unknown;
      Light: unknown;
      Auto: unknown;
    };
    new (
      element: HTMLElement,
      options?: Record<string, unknown>
    ): {
      destroy: () => void;
      setRegionAnimated: (region: unknown, animated: boolean) => void;
      colorScheme: unknown;
      addEventListener: (type: string, listener: (e: { pointOnPage?: { x: number; y: number } }) => void) => void;
      convertPointOnPageToCoordinate: (point: DOMPoint) => { latitude: number; longitude: number };
      addAnnotation: (annotation: unknown) => void;
      removeAnnotation: (annotation: unknown) => void;
      addOverlay: (overlay: unknown) => void;
      removeOverlay: (overlay: unknown) => void;
    };
  };
  Coordinate: new (latitude: number, longitude: number) => { latitude: number; longitude: number };
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  MarkerAnnotation: new (
    coordinate: unknown,
    options?: {
      color?: string;
      title?: string;
      draggable?: boolean;
    }
  ) => {
    coordinate: { latitude: number; longitude: number };
    draggable: boolean;
    addEventListener: (type: string, listener: () => void) => void;
  };
  CircleOverlay: new (coordinate: unknown, radius: number, options?: Record<string, unknown>) => unknown;
  Style: new (options?: Record<string, unknown>) => unknown;
  FeatureVisibility: {
    Adaptive: unknown;
    Hidden: unknown;
    Visible: unknown;
  };
}

declare global {
  interface Window {
    mapkit?: MapKitGlobal;
    __mapkit_init_promise?: Promise<boolean>;
  }
}

const MAPKIT_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

async function loadMapKitScript(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (window.mapkit) {
    return true;
  }

  if (window.__mapkit_init_promise) {
    return window.__mapkit_init_promise;
  }

  window.__mapkit_init_promise = new Promise((resolve) => {
    // 1. Obtener token del endpoint
    fetch("/api/mapkit/token")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.token) {
          resolve(false);
          return;
        }

        // 2. Inyectar script si no existe
        const existingScript = document.querySelector(`script[src="${MAPKIT_SCRIPT_URL}"]`);
        const onScriptLoaded = () => {
          if (!window.mapkit) {
            resolve(false);
            return;
          }

          try {
            window.mapkit.init({
              authorizationCallback: (done: (token: string) => void) => {
                done(data.token);
              },
              language: "es",
            });
            resolve(true);
          } catch (e) {
            console.warn("[MapKit] Error en mapkit.init:", e);
            resolve(false);
          }
        };

        if (existingScript) {
          if (window.mapkit) onScriptLoaded();
          else existingScript.addEventListener("load", onScriptLoaded);
          return;
        }

        const script = document.createElement("script");
        script.src = MAPKIT_SCRIPT_URL;
        script.crossOrigin = "anonymous";
        script.async = true;
        script.onload = onScriptLoaded;
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      })
      .catch(() => resolve(false));
  });

  return window.__mapkit_init_promise;
}

export function useMapKit() {
  const [isReady, setIsReady] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    loadMapKitScript().then((ok) => {
      if (!mounted) return;
      setIsAvailable(ok);
      setIsReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return {
    isReady,
    isAvailable: !!isAvailable,
    mapkit: typeof window !== "undefined" ? window.mapkit : undefined,
  };
}
