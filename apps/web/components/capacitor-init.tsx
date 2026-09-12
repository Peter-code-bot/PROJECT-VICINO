"use client";

import { useEffect } from "react";
import { OAUTH_DEEP_LINK_CALLBACK, FCM_TOKEN_DEEP_LINK_PREFIX } from "@/lib/auth/deep-link-constants";

/**
 * A4 sub-fase 4.2: smart back button + cleanup de los 4 listeners de
 * Capacitor.
 *
 * El back button del WebView consulta un priority order de 5 niveles
 * (Radix modal -> custom modal -> tab siguiendo -> history -> double-tap-exit)
 * antes de cualquier navegacion. Los 4 listeners de plugin (backButton,
 * appUrlOpen, keyboardWillShow, keyboardWillHide) se guardan en un array
 * de handles y se remueven en el cleanup del useEffect (cierra el follow-up
 * de A1: listeners no removidos -> acumulacion bajo StrictMode/HMR).
 *
 * Convencion para custom modals: setear data-modal-open="true" en el root
 * del modal cuando abierto + escuchar keydown Escape para cerrarse. Radix
 * Dialog/DropdownMenu/Popover lo hacen automaticamente (renderean
 * [data-state="open"] y ya escuchan Escape).
 */

const TOAST_GRACE_MS = 2000;

// Module-level state para el double-tap-exit. Persiste a traves del lifecycle
// del componente; se resetea en el cleanup del useEffect para evitar arrastrar
// estado a un remount.
let lastBackPress = 0;

export function CapacitorInit() {
  useEffect(() => {
    // El cleanup debe poder remover handles que resuelven DESPUES de que el
    // effect ya unmount (StrictMode dev / HMR). cancelled = true desde el
    // cleanup; cada await checkpoint verifica el flag y si ya esta cancelado,
    // remueve inmediatamente el handle que acababa de resolver.
    const state = {
      handles: [] as Array<{ remove: () => Promise<void> }>,
      cancelled: false,
    };

    const init = async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (state.cancelled || !Capacitor.isNativePlatform()) return;

      // Independiente de OAuth, barra y teclado: sus fallos no anulan Realtime.
      void Promise.all([
        import("@/lib/realtime/pausa-en-segundo-plano"),
        import("@/lib/realtime/canales-gestionados"),
        import("@/lib/supabase/client"),
      ]).then(([{ iniciarPausaNativa }, { canalesGestionados }, { createClient }]) => {
        if (state.cancelled) return;
        const handle = iniciarPausaNativa(canalesGestionados(createClient()));
        state.handles.push(handle);
      }).catch(() => { console.warn("[realtime] lifecycle nativo no disponible"); });

      // Mark native context for CSS targeting (scrollbar hiding, etc.)
      document.body.classList.add("is-capacitor");

      // El splash se quita AQUI, lo primero. Antes estaba al final de init(),
      // detras de tres round-trips del puente nativo (backButton, appUrlOpen,
      // getLaunchUrl) y de un setTimeout de 500 ms. Nada de eso hace falta para
      // dejar de tapar una pantalla que, cuando este efecto corre, ya esta
      // pintada debajo: el useEffect no se ejecuta hasta que React hidrata.
      //
      // Se lanza sin await a proposito. Si el chunk de @capacitor/splash-screen
      // no llega (son 583 B que webpack saco a un fichero aparte, o sea una
      // peticion de red mas contra vicinomarket.com), el resto del arranque no
      // se queda esperando. Y si falla, el launchAutoHide del config lo quita
      // igual al alcanzar su techo de 15 s.
      void import("@capacitor/splash-screen")
        .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 300 }))
        .catch(() => {});

      // --- Smart back button ---
      const { App } = await import("@capacitor/app");
      if (state.cancelled) return;

      const handleBackButton = async ({ canGoBack }: { canGoBack: boolean }) => {
        // A4 sub-fase 4.2 (codex follow-up H4): try/catch boundary. Capacitor
        // invoca el listener con .catch() floateado — un reject (ej. import
        // de sonner falla por red) burbujearia como unhandledRejection sin
        // este wrapper. Fail-silent: el back button no debe crashear la app.
        try {
          // (1) Radix modal abierto? Dispatch Escape sintetico, Radix cierra
          // automaticamente. NO triggers el backButton evento nativo (es JS
          // keydown, distinto layer), asi que no hay loop.
          const radixOpen = document.querySelector(
            '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]',
          );
          if (radixOpen) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            return;
          }

          // (2) Custom modal abierto? Convencion data-modal-open="true".
          // El modal debe tener su propio listener de keydown Escape que
          // llame su setOpen(false).
          const customOpen = document.querySelector('[data-modal-open="true"]');
          if (customOpen) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            return;
          }

          // (3) Tab "siguiendo" del home? Volver a "parati" via history.back
          // (el user llego a /?feed=following clickeando el Link de HomeTabs
          // desde /, asi que history.back lo lleva a /).
          const url = new URL(window.location.href);
          if (url.pathname === "/" && url.searchParams.get("feed") === "following") {
            window.history.back();
            return;
          }

          // (4) Hay history? Back normal.
          if (canGoBack) {
            window.history.back();
            return;
          }

          // (5) Root + double-tap-exit. Primer tap: toast + arranca grace
          // window. Segundo tap dentro de TOAST_GRACE_MS: App.exitApp.
          const now = Date.now();
          if (now - lastBackPress < TOAST_GRACE_MS) {
            await App.exitApp();
            return;
          }
          lastBackPress = now;
          const { toast } = await import("sonner");
          toast("Presiona de nuevo para salir", { duration: TOAST_GRACE_MS });
        } catch (err) {
          console.error("[capacitor-init] handleBackButton error:", err);
        }
      };

      const backH = await App.addListener("backButton", handleBackButton);
      if (state.cancelled) {
        void backH.remove();
        return;
      }
      state.handles.push(backH);

      // --- Deep links ---
      // OAuth callback URLs (vicino://auth/callback*) son owned EXCLUSIVAMENTE
      // por OAuthUrlListener. Sin este guard, este listener race-condicionaria
      // contra OAuthUrlListener y stripearia el ?code= del query string.
      // Constante centralizada en lib/auth/deep-link-constants.ts -- usada
      // aqui como PREFIJO (startsWith) porque la URL delivered incluye
      // ?code=... despues del path.
      const urlH = await App.addListener("appUrlOpen", ({ url }) => {
        // OAuth callback -> OAuthUrlListener. FCM token bridge -> usePushNotifications.
        // Ambos son owned por otros listeners; sin estos guards este handler
        // navegaria a /<token> o stripearia el ?code= del OAuth.
        if (
          url.startsWith(OAUTH_DEEP_LINK_CALLBACK) || 
          url.startsWith(FCM_TOKEN_DEEP_LINK_PREFIX) ||
          url.startsWith("https://vicinomarket.com/auth/callback")
        ) return;
        
        try {
          const u = new URL(url);
          // Include search and hash. Even if path is "/", if there are search params (like ?code=), we must navigate.
          const fullPath = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
          if (fullPath && fullPath !== "/") {
            window.location.href = fullPath || "/";
          }
        } catch {}
      });
      if (state.cancelled) {
        void urlH.remove();
        return;
      }
      state.handles.push(urlH);

      // Cold-start deep link
      const launchUrl = await App.getLaunchUrl();
      if (state.cancelled) return;
      if (
        launchUrl?.url &&
        !launchUrl.url.startsWith(OAUTH_DEEP_LINK_CALLBACK) &&
        !launchUrl.url.startsWith(FCM_TOKEN_DEEP_LINK_PREFIX) &&
        !launchUrl.url.startsWith("https://vicinomarket.com/auth/callback")
      ) {
        try {
          const u = new URL(launchUrl.url);
          const fullPath = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
          if (fullPath && fullPath !== "/") {
            window.location.href = fullPath || "/";
          }
        } catch {}
      }

      // --- Status bar: fallo aislado; el teclado aun debe inicializarse. ---
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        if (state.cancelled) return;
        let requested = false;
        let applying = false;
        const updateStatusBarTheme = () => {
          requested = true;
          if (applying) return;
          applying = true;
          void (async () => {
            while (requested && !state.cancelled) {
              requested = false;
              const isDark = document.documentElement.classList.contains("dark");
              const token = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
              const color = /^#[0-9a-fA-F]{3,8}$/.test(token) ? token : isDark ? "#050907" : "#FFF8F0";
              // Dark significa iconos claros. Android 15+ puede ignorar el fondo;
              // esto no acredita la correccion del primer frame edge-to-edge.
              const results = await Promise.allSettled([
                StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }),
                StatusBar.setBackgroundColor({ color }),
              ]);
              if (results.some((result) => result.status === "rejected")) {
                console.warn("[status-bar] no se pudo aplicar el tema");
              }
            }
          })().catch(() => {
            console.warn("[status-bar] tema no disponible");
          }).finally(() => {
            applying = false;
            // Una mutacion puede llegar entre la ultima condicion del bucle y
            // este finally. Vuelve a arrancar para no perder ese tema final.
            if (requested && !state.cancelled) updateStatusBarTheme();
          });
        };
        updateStatusBarTheme();
        const observer = new MutationObserver(updateStatusBarTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        state.handles.push({ remove: async () => { observer.disconnect(); } });
      } catch {
        console.warn("[status-bar] plugin no disponible");
      }

      // --- Keyboard: set CSS variable for keyboard height ---
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const kbShowH = await Keyboard.addListener("keyboardWillShow", (info) => {
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${info.keyboardHeight}px`,
          );
          document.body.classList.add("keyboard-open");
        });
        if (state.cancelled) {
          void kbShowH.remove();
          return;
        }
        state.handles.push(kbShowH);

        const kbHideH = await Keyboard.addListener("keyboardWillHide", () => {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.body.classList.remove("keyboard-open");
        });
        if (state.cancelled) {
          void kbHideH.remove();
          return;
        }
        state.handles.push(kbHideH);
      } catch {}
    };

    // El catch estaba vacio. Cualquier fallo entre el import de Capacitor y el
    // final de init() desaparecia sin log ni Sentry, y hasta este cambio se
    // llevaba por delante el hide del splash. Ahora el splash ya se quito mucho
    // antes, pero el fallo sigue mereciendo verse: es justo el hueco de arranque
    // donde hoy no tenemos ninguna visibilidad.
    init().catch((err) => {
      console.warn("[capacitor-init] fallo en el arranque nativo", err);
      // @sentry/react, NO @sentry/nextjs. Este catch solo puede correr en la app
      // nativa (justo encima hay un return si no lo es), y ahi @sentry/nextjs no
      // tiene cliente a proposito: instrumentation-client envuelve su init en
      // `if (!isCapacitor)` para no duplicar cuota, y quien inicializa es
      // capacitor-sentry-init con @sentry/capacitor.
      //
      // No basta con que compartan el objeto global: el carrier de Sentry se
      // indexa por VERSION exacta, y conviven dos copias de @sentry/core (10.54.0
      // la de nextjs, 10.43.0 la de capacitor). Son cubos distintos, asi que
      // captureException devolveria un eventId y tiraria el evento en silencio.
      // @sentry/react esta fijado a 10.43.0 y comparte carrier con capacitor.
      void import("@sentry/react")
        .then((S) => S.captureException(err, { tags: { fase: "capacitor-init" } }))
        .catch(() => {});
    });

    return () => {
      state.cancelled = true;
      // Remove all listeners that already resolved.
      state.handles.forEach((h) => {
        void h.remove();
      });
      // Reset double-tap grace window — evita que un mount nuevo herede
      // un lastBackPress stale de la sesion anterior.
      lastBackPress = 0;
    };
  }, []);

  return null;
}
