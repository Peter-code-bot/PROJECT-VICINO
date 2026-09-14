"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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

// Una vez POR MOTIVO, no una vez por sesion. Con un solo booleano global, el
// primer fallo apagaba el reporte de todos los demas: un timeout al arrancar
// dejaba invisible el token caducado de media hora despues, que es justo el que
// hay que ver.
const motivosReportados = new Set<string>();
function reportMapKitError(reason: string, extra?: unknown) {
  if (motivosReportados.has(reason)) return;
  motivosReportados.add(reason);
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

export type MapKitFailure = { reason: "rate_limited" | "unavailable" | "forbidden" | "network_failure"; retryAfter?: number };
let currentFailure: MapKitFailure | null = null;
let retryAllowedAt = 0;
const failureListeners = new Set<(failure: MapKitFailure | null) => void>();
function publishFailure(failure: MapKitFailure | null) {
  currentFailure = failure;
  retryAllowedAt = failure?.retryAfter ? Date.now() + failure.retryAfter * 1000 : 0;
  for (const listener of failureListeners) listener(failure);
}

type TokenResult = { ok: true; token: string } | { ok: false; failure: MapKitFailure };
async function fetchTokenFresh(): Promise<TokenResult> {
  try {
    const res = await fetch("/api/mapkit/token");
    if (!res.ok) {
      const retryHeader = res.headers.get("Retry-After");
      const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
      const failure: MapKitFailure = {
        reason: res.status === 429 ? "rate_limited" : res.status === 403 ? "forbidden" : "unavailable",
        ...(Number.isFinite(retrySeconds) && retrySeconds > 0 ? { retryAfter: retrySeconds } : {}),
      };
      return { ok: false, failure };
    }
    const data = await res.json();
    return typeof data?.token === "string" && data.token
      ? { ok: true, token: data.token }
      : { ok: false, failure: { reason: "unavailable" } };
  } catch {
    return { ok: false, failure: { reason: "network_failure" } };
  }
}

function initializeMapKit(mapkit: MapKitGlobal, initialToken: string) {
  let firstTokenAvailable = true;
  mapkit.init({
    authorizationCallback: (done) => {
      if (firstTokenAvailable) {
        firstTokenAvailable = false;
        done(initialToken);
        return;
      }
      void fetchTokenFresh().then((result) => {
        if (result.ok) {
          publishFailure(null);
          done(result.token);
        } else {
          publishFailure(result.failure);
          reportMapKitError(`Refresco de token: ${result.failure.reason}`);
          done("");
        }
      });
    },
    language: "es",
  });
  publishFailure(null);
}

let reauthorizePromise: Promise<boolean> | null = null;
async function reauthorizeMapKit(): Promise<boolean> {
  if (reauthorizePromise) return reauthorizePromise;
  reauthorizePromise = (async () => {
    const token = await fetchTokenFresh();
    if (!token.ok) {
      publishFailure(token.failure);
      reportMapKitError(`Token de MapKit: ${token.failure.reason}`);
      return false;
    }
    try {
      initializeMapKit(window.mapkit!, token.token);
      return true;
    } catch {
      publishFailure({ reason: "unavailable" });
      reportMapKitError("Error durante mapkit.init()");
      return false;
    }
  })().finally(() => { reauthorizePromise = null; });
  return reauthorizePromise;
}

export async function loadMapKitScript(forceReauthorize = false): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (currentFailure && !forceReauthorize) return false;

  if (window.mapkit) {
    return forceReauthorize ? reauthorizeMapKit() : currentFailure === null;
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
        if (!initialToken.ok) {
          clearTimeout(timer);
          publishFailure(initialToken.failure);
          finish(false, `Token de MapKit: ${initialToken.failure.reason}`);
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
            initializeMapKit(window.mapkit, initialToken.token);
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
  const [failure, setFailure] = useState<MapKitFailure | null>(currentFailure);
  const [retryAt, setRetryAt] = useState(retryAllowedAt);
  const [now, setNow] = useState(() => Date.now());
  const retryingRef = useRef(false);

  useEffect(() => {
    let active = true;
    const onFailure = (next: MapKitFailure | null) => {
      if (!active) return;
      setFailure(next);
      setRetryAt(retryAllowedAt);
      if (next) {
        setIsAvailable(false);
        setIsReady(true);
      }
    };
    failureListeners.add(onFailure);
    loadMapKitScript().then((ok) => {
      if (!active) return;
      setIsAvailable(ok);
      setIsReady(true);
    });
    return () => {
      active = false;
      failureListeners.delete(onFailure);
    };
  }, []);

  useEffect(() => {
    if (retryAt <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt, now]);

  const retry = useCallback(() => {
    if (retryingRef.current || Date.now() < retryAllowedAt) return;
    retryingRef.current = true;
    if (typeof window !== "undefined") {
      delete window.__mapkit_init_promise;
      if (!window.mapkit) document.querySelector(`script[src="${MAPKIT_SCRIPT_URL}"]`)?.remove();
    }
    // Un reintento explicito del usuario es un evento nuevo: si vuelve a fallar,
    // queremos verlo en Sentry aunque ya hubieramos reportado ese mismo motivo.
    motivosReportados.clear();
    setIsReady(false);
    loadMapKitScript(true).then((ok) => {
      setIsAvailable(ok);
      setIsReady(true);
    }).finally(() => { retryingRef.current = false; });
  }, []);

  return {
    isReady,
    isAvailable: !!isAvailable,
    mapkit: typeof window !== "undefined" ? window.mapkit : undefined,
    retry,
    failure,
    retryWaitSeconds: retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0,
  };
}
