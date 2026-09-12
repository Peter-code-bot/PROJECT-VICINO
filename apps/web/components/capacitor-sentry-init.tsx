"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { iniciarSentryNativo, confirmarRutaNativa, cerrarRutaNativa, plataformaNativa } from "@/lib/observability/sentry-nativo";

export function CapacitorSentryInit() {
  const pathname = usePathname();
  useEffect(() => {
    if (!plataformaNativa()) return;
    void iniciarSentryNativo(true).catch(() => {});
    // El retorno a primer plano usa el unico listener del lifecycle nativo.
    return () => {
      cerrarRutaNativa();
    };
  }, []);

  useEffect(() => {
    if (plataformaNativa()) confirmarRutaNativa(pathname);
  }, [pathname]);
  return null;
}
