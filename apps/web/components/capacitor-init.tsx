"use client";

import { useEffect } from "react";

export function CapacitorInit() {
  useEffect(() => {
    const init = async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      // Mark native context for CSS targeting (scrollbar hiding, etc.)
      document.body.classList.add("is-capacitor");

      // --- Back button (Android) ---
      const { App } = await import("@capacitor/app");
      App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });

      // --- Deep links ---
      // OAuth callback URLs (vicino://auth/callback*) are owned EXCLUSIVELY by
      // OAuthUrlListener (components/auth/oauth-url-listener.tsx). It calls
      // exchangeCodeForSession and then window.location.replace("/"). Without
      // the guard below, this listener races OAuthUrlListener and navigates the
      // WebView to "/callback" first, stripping the ?code= query string. The
      // /callback page (apps/web/app/callback/page.tsx) covers the landing by
      // forwarding to /auth/callback, but the result is a non-deterministic
      // multi-hop navigation that defeats F2's window.location.replace("/").
      const OAUTH_CALLBACK_PREFIX = "vicino://auth/callback";

      App.addListener("appUrlOpen", ({ url }) => {
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

      // Check cold-start deep link
      const launchUrl = await App.getLaunchUrl();
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
      setTimeout(() => SplashScreen.hide({ fadeOutDuration: 300 }), 500);

      // --- Status bar ---
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      StatusBar.setStyle({ style: Style.Dark });
      StatusBar.setBackgroundColor({ color: "#0D0D1A" });

      // --- Keyboard: set CSS variable for keyboard height ---
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        Keyboard.addListener("keyboardWillShow", (info) => {
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${info.keyboardHeight}px`
          );
          document.body.classList.add("keyboard-open");
        });
        Keyboard.addListener("keyboardWillHide", () => {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.body.classList.remove("keyboard-open");
        });
      } catch {}
    };

    init().catch(() => {});
  }, []);

  return null;
}
