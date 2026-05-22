"use client";

import * as React from "react";
import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

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

  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
