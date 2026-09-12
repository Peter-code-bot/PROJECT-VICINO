"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { iniciarSentryNativo, confirmarRutaNativa, cerrarRutaNativa } from "@/lib/observability/sentry-nativo";

export function CapacitorSentryInit() {
  const pathname = usePathname();
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    void iniciarSentryNativo(true).catch(() => {});
    // El retorno a primer plano usa el unico listener del lifecycle nativo.
    return () => {
      cerrarRutaNativa();
    };
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() === "android") confirmarRutaNativa(pathname);
  }, [pathname]);
  return null;
}
