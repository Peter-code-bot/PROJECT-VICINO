"use client";

import * as React from "react";
import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

function ThemeSync() {
  const { theme, systemTheme } = useTheme();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const syncStatusBar = async () => {
      const currentTheme = theme === "system" ? systemTheme : theme;
      
      // Esperar a que next-themes hidrate el tema antes de aplicarlo
      if (!currentTheme) return; 
      
      console.log(`[ThemeSync] Aplicando tema de Status Bar: ${currentTheme}`);
      
      try {
        if (currentTheme === "dark") {
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setBackgroundColor({ color: "#050907" });
        } else {
          await StatusBar.setStyle({ style: Style.Light });
          await StatusBar.setBackgroundColor({ color: "#FFF8F0" });
        }
      } catch (err) {
        console.error("[ThemeSync] Error sincronizando status bar:", err);
      }
    };

    syncStatusBar();
  }, [theme, systemTheme]);

  return null;
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // Suppress React 19 false positive warning for next-themes script tag
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("Encountered a script tag")) return;
      orig.apply(console, args);
    };
    return () => { console.error = orig; };
  }, []);

  return (
    <NextThemesProvider {...props}>
      <ThemeSync />
      {children}
    </NextThemesProvider>
  );
}
