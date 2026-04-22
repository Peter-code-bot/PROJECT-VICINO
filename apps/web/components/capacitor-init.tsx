"use client";

import { useEffect } from "react";

export function CapacitorInit() {
  useEffect(() => {
    const init = async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

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
      App.addListener("appUrlOpen", ({ url }) => {
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
      if (launchUrl?.url) {
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
