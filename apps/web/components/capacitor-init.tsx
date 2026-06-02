"use client";

import { useEffect } from "react";

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

      // Mark native context for CSS targeting (scrollbar hiding, etc.)
      document.body.classList.add("is-capacitor");

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
          // eslint-disable-next-line no-console -- back button handler debe loguear errores nativos
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
      const OAUTH_CALLBACK_PREFIX = "vicino://auth/callback";

      const urlH = await App.addListener("appUrlOpen", ({ url }) => {
        if (url.startsWith(OAUTH_CALLBACK_PREFIX)) return;
        try {
          const u = new URL(url);
          // vicino:// scheme or https links
          const path = u.pathname || u.host || "/";
          if (path && path !== "/") {
            window.location.href = path;
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
      if (launchUrl?.url && !launchUrl.url.startsWith(OAUTH_CALLBACK_PREFIX)) {
        try {
          const u = new URL(launchUrl.url);
          const path = u.pathname || u.host || "";
          if (path && path !== "/") {
            window.location.href = path;
          }
        } catch {}
      }

      // --- Splash screen: hide after web loaded ---
      const { SplashScreen } = await import("@capacitor/splash-screen");
      if (state.cancelled) return;
      setTimeout(() => SplashScreen.hide({ fadeOutDuration: 300 }), 500);

      // --- Status bar ---
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      if (state.cancelled) return;
      StatusBar.setStyle({ style: Style.Dark });
      StatusBar.setBackgroundColor({ color: "#0D0D1A" });

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

    init().catch(() => {});

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
