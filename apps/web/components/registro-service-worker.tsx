"use client";

import { useEffect } from "react";

/** Lo unico que se usa del Workbox que sw-entry.js de next-pwa cuelga de window. */
type VentanaConWorkbox = Window & { workbox?: { register: () => Promise<unknown> } };

/**
 * Registra el service worker de next-pwa, haciendose cargo de su rechazo.
 *
 * POR QUE NO `register: true`. Con esa opcion el sw-entry.js del paquete hace
 * `window.workbox.register()` sin .catch, y workbox-window relanza cualquier
 * fallo de navigator.serviceWorker.register. Todo rechazo acababa en
 * onunhandledrejection y Sentry lo contaba como error:
 *   - «Error: Rejected» (7522543334, abierto desde el 2-jun, 28 eventos la
 *     semana del 25-sep): el Web Rendering Service de Google (GoogleOther)
 *     sustituye serviceWorker.register por un stub que rechaza. Son visitas
 *     del rastreador, no de personas.
 *   - «AbortError: Failed to register a ServiceWorker» (VICINO-WEB-17, 1-oct):
 *     un movil que no pudo bajar /sw.js.
 * Ninguno se arregla desde el codigo y ninguno rompe nada: sin service worker
 * la pagina funciona igual, solo sin los estaticos en cache.
 *
 * Con `register: false` sw-entry.js sigue creando window.workbox y todo lo
 * demas; aqui solo se hace el register() que el paquete hacia, con su catch.
 * Va en el layout RAIZ para cubrir tambien /terminos, /privacidad y las rutas
 * de auth, que no cuelgan de (marketplace). register() espera al evento load
 * si la pagina aun no termino de cargar, igual que antes.
 *
 * Sin window.workbox no hay nada que hacer: en desarrollo next-pwa esta
 * desactivado, y sin soporte de service worker sw-entry.js no lo crea.
 */
export function RegistroServiceWorker() {
  useEffect(() => {
    const workbox = (window as VentanaConWorkbox).workbox;
    if (typeof workbox?.register !== "function") return;
    workbox.register().catch((error: unknown) => {
      // A consola y no a Sentry: no es accionable, y la consola ya deja un
      // breadcrumb por si otro error de la misma sesion necesita contexto.
      console.warn("[pwa] no se pudo registrar el service worker:", error);
    });
  }, []);

  return null;
}
