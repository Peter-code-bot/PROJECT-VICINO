"use client";

import { useState, useEffect, useCallback } from "react";

export interface MapKitCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapKitStructuredAddress {
  countryCode?: string;
  [key: string]: unknown;
}

export interface MapKitPlace {
  name?: string;
  formattedAddress?: string;
  coordinate?: MapKitCoordinate;
  countryCode?: string;
  structuredAddress?: MapKitStructuredAddress;
  subLocality?: string;
  subThoroughfare?: string;
  locality?: string;
  administrativeArea?: string;
  postCode?: string;
  postalCode?: string;
  displayLines?: string[];
}

export interface MapKitSearchResponse {
  places?: MapKitPlace[];
}

export interface MapKitAutocompleteResult {
  name?: string;
  formattedAddress?: string;
  coordinate?: MapKitCoordinate;
  countryCode?: string;
  structuredAddress?: MapKitStructuredAddress;
  displayLines?: string[];
}

export interface MapKitAutocompleteResponse {
  results?: MapKitAutocompleteResult[];
  places?: MapKitPlace[];
}

export interface MapKitGeocoderResponse {
  results?: MapKitPlace[];
}

export interface MapKitSearchInstance {
  search: (
    query: string,
    callback: (error: Error | null, data: MapKitSearchResponse | null) => void
  ) => void;
  autocomplete?: (
    query: string,
    callback: (error: Error | null, data: MapKitAutocompleteResponse | null) => void
  ) => void;
}

export interface MapKitGeocoderInstance {
  reverseLookup: (
    coordinate: unknown,
    callback: (error: Error | null, data: MapKitGeocoderResponse | null) => void
  ) => void;
}

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
  Search: new (options?: {
    limitToCountries?: string;
    region?: unknown;
    language?: string;
  }) => MapKitSearchInstance;
  Geocoder: new (options?: {
    language?: string;
  }) => MapKitGeocoderInstance;
}

declare global {
  interface Window {
    mapkit?: MapKitGlobal;
    __mapkit_init_promise?: Promise<boolean>;
  }
}

import * as Sentry from "@sentry/nextjs";

const MAPKIT_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
const LOAD_TIMEOUT_MS = 8000;

let sentryReported = false;
function reportMapKitError(reason: string, extra?: unknown) {
  if (sentryReported) return;
  sentryReported = true;
  try {
    Sentry.captureMessage(`[MapKit] ${reason}`, {
      level: "warning",
      tags: { mapkit: "true" },
      extra: { extra },
    });
  } catch {
    // Sentry no disponible o inicializado
  }
}

async function fetchTokenFresh(): Promise<string | null> {
  try {
    const res = await fetch("/api/mapkit/token");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.token === "string" ? data.token : null;
  } catch (err) {
    console.warn("[MapKit] Error al obtener token:", err);
    return null;
  }
}

export async function loadMapKitScript(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (window.mapkit) {
    return true;
  }

  if (window.__mapkit_init_promise) {
    return window.__mapkit_init_promise;
  }

  const promise = new Promise<boolean>((resolve) => {
    let resolved = false;
    const finish = (success: boolean, failureReason?: string) => {
      if (resolved) return;
      resolved = true;
      if (!success) {
        // No cachear el resultado negativo para permitir reintentos posteriores
        delete window.__mapkit_init_promise;
        if (failureReason) {
          reportMapKitError(failureReason);
        }
      }
      resolve(success);
    };

    // Timeout de carga de 8 segundos
    const timer = setTimeout(() => {
      finish(false, "Timeout al inicializar MapKit (8s)");
    }, LOAD_TIMEOUT_MS);

    // 1. Verificar disponibilidad de token fresco
    fetchTokenFresh()
      .then((initialToken) => {
        if (!initialToken) {
          clearTimeout(timer);
          finish(false, "Token de MapKit no disponible o credenciales ausentes");
          return;
        }

        // 2. Inyectar script si no existe
        const existingScript = document.querySelector(`script[src="${MAPKIT_SCRIPT_URL}"]`);
        const onScriptLoaded = () => {
          if (!window.mapkit) {
            clearTimeout(timer);
            finish(false, "Script de MapKit cargó pero window.mapkit no está definido");
            return;
          }

          try {
            window.mapkit.init({
              // B-3: Refresco dinámico de token cada vez que Apple lo solicite (expiración de 30 min)
              authorizationCallback: (done: (token: string) => void) => {
                fetchTokenFresh().then((freshToken) => {
                  if (freshToken) {
                    done(freshToken);
                  } else {
                    console.warn("[MapKit] Falló refresco dinámico de token");
                  }
                });
              },
              language: "es",
            });
            clearTimeout(timer);
            finish(true);
          } catch (e) {
            console.warn("[MapKit] Error en mapkit.init:", e);
            clearTimeout(timer);
            finish(false, "Error durante mapkit.init()");
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
        script.onerror = () => {
          clearTimeout(timer);
          finish(false, "Error de red al cargar el script CDN de MapKit");
        };
        document.head.appendChild(script);
      })
      .catch((err) => {
        clearTimeout(timer);
        finish(false, `Error inesperado al inicializar: ${String(err)}`);
      });
  });

  window.__mapkit_init_promise = promise;
  return promise;
}

export function useMapKit() {
  const [isReady, setIsReady] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    loadMapKitScript().then((ok) => {
      if (!active) return;
      setIsAvailable(ok);
      setIsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const retry = useCallback(() => {
    if (typeof window !== "undefined") {
      delete window.__mapkit_init_promise;
    }
    setIsReady(false);
    loadMapKitScript().then((ok) => {
      setIsAvailable(ok);
      setIsReady(true);
    });
  }, []);

  return {
    isReady,
    isAvailable: !!isAvailable,
    mapkit: typeof window !== "undefined" ? window.mapkit : undefined,
    retry,
  };
}
