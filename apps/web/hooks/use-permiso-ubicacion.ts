"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ESTADO_PERMISO_INICIAL,
  observarPermisoUbicacion,
  pedirPermisoUbicacion,
  type EntornoPermiso,
  type EstadoPermisoUbicacion,
  type ObservadorPermiso,
} from "@/lib/geo/permiso-ubicacion";

/**
 * Las fronteras reales: Capacitor y el navegador. Los plugins se cargan con
 * import() dinámico y DENTRO de un objeto (los plugins de Capacitor son Proxy
 * thenables: ver lib/realtime/pausa-en-segundo-plano.ts), y solo en nativo: en
 * web el módulo nunca llega a pedirlos.
 */
function entornoDelNavegador(): EntornoPermiso {
  return {
    esNativo: () => Capacitor.isNativePlatform(),
    pluginDisponible: () => Capacitor.isPluginAvailable("Geolocation"),
    plataforma: () => Capacitor.getPlatform(),
    cargarPlugin: () => import("@capacitor/geolocation").then(({ Geolocation }) => ({ geo: Geolocation })),
    cargarApp: () => import("@capacitor/app").then(({ App }) => ({ app: App })),
    permisosWeb: () => (typeof navigator === "undefined" ? undefined : navigator.permissions),
    geolocWeb: () => (typeof navigator === "undefined" ? undefined : navigator.geolocation),
    documento: document,
  };
}

/**
 * Estado del permiso de ubicación, leído sin mostrar ningún diálogo al montar y
 * al volver a la app (lib/geo/permiso-ubicacion.ts).
 *
 * Arranca en «desconocido» en el servidor y al hidratar, así que el primer
 * render no depende del dispositivo. Todavía no lo usa ninguna pantalla.
 *
 * `pedirPermiso` muestra el diálogo del sistema: LLAMARLO SOLO DESDE UN GESTO
 * DE LA PERSONA, nunca desde un efecto.
 */
export function usePermisoUbicacion() {
  const [permiso, setPermiso] = useState<EstadoPermisoUbicacion>(ESTADO_PERMISO_INICIAL);
  const observador = useRef<ObservadorPermiso | null>(null);

  useEffect(() => {
    const actual = observarPermisoUbicacion(entornoDelNavegador(), setPermiso);
    observador.current = actual;
    return () => {
      actual.detener();
      if (observador.current === actual) observador.current = null;
    };
  }, []);

  const pedirPermiso = useCallback(async () => {
    const estado = await pedirPermisoUbicacion(entornoDelNavegador());
    // Por el observador, para que una relectura que ya estaba en curso (con el
    // estado de ANTES del diálogo) no pise la respuesta.
    if (observador.current) observador.current.anotar(estado);
    else setPermiso(estado);
    return estado;
  }, []);

  return { permiso, pedirPermiso };
}
