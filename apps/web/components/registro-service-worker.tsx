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
 * la pagina funciona igual, solo sin los estaticos en cache. Evidencia del
 * primero: el correo de alta del issue (2-jun) trae browser=GoogleOther,
 * mechanism=onunhandledrejection y el frame
 * wrsParams.serviceWorkers.navigator.serviceWorker.register.
 *
 * Solo esos dos se quedan en consola (esRuidoConocido). Cualquier otro rechazo
 * se relanza y sigue llegando a Sentry como antes: un fallo sistematico del
 * registro (/sw.js con 404, una redireccion, un MIME malo) deja la PWA sin
 * cache para todos y tiene que verse.
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
      if (esRuidoConocido(error)) {
        // A consola y no a Sentry: no es accionable, y la consola ya deja un
        // breadcrumb por si otro error de la misma sesion necesita contexto.
        console.warn("[pwa] no se pudo registrar el service worker:", error);
        return;
      }
      // Todo lo demas se relanza tal cual. Asi llega a onunhandledrejection
      // como antes, y de ahi a Sentry por sus global handlers, que estan en la
      // web y en la app de Android. Un captureException de @sentry/nextjs no
      // valdria para la app: alli ese SDK no tiene cliente y el evento se
      // perderia (ver capacitor-init.tsx).
      throw error;
    });
  }, []);

  return null;
}

/**
 * Los dos rechazos que se sabe que no son nuestros, y SOLO esos:
 *   - el stub de GoogleOther, que rechaza con exactamente Error("Rejected");
 *   - AbortError: el navegador no pudo bajar /sw.js (red).
 * Lo que NO entra aqui y tiene que seguir viendose en Sentry es justo lo que
 * romperia el registro para todos: /sw.js con 404 (TypeError), detras de una
 * redireccion o con un MIME que no es JavaScript (SecurityError).
 */
function esRuidoConocido(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === "AbortError" || message === "Rejected";
}
