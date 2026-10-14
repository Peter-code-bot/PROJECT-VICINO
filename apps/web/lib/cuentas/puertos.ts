"use client";

/**
 * Los puertos REALES de lib/cuentas/cambio.ts: el cliente de Supabase de la
 * app, la boveda, la marca de cambio en curso y Sentry.
 *
 * Separado de cambio.ts para que ese modulo se pueda probar con node:test sin
 * navegador ni red. Aqui no hay logica, solo cables.
 */
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";
import { buscarCuenta, guardarCuenta, quitarCuenta } from "./boveda";
import { desmarcarCambioEnCurso, marcarCambioEnCurso } from "./cambio-en-curso";
import type { PuertoCambio } from "./cambio";
import { probarSesion } from "./sesion-aislada";

export function reportarCuentas(paso: string, error: unknown, nivel: "warning" | "error" = "error"): void {
  // Solo el paso y la clase del error: por aqui no pasa ningun token.
  const estado = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  Sentry.captureException(error, {
    level: nivel,
    tags: { modulo: "cuentas", paso },
    contexts: { auth: { status: typeof estado === "number" ? estado : null } },
  });
}

export function puertoCambioReal(): PuertoCambio {
  const supabase = createClient();
  return {
    principal: {
      getSession: () => supabase.auth.getSession(),
      setSession: (tokens) => supabase.auth.setSession(tokens),
    },
    probar: (tokens) => probarSesion(tokens),
    async soltarTokenPush(userId) {
      // Igual que hooks/use-logout.ts: el token de FCM es del telefono. Si no
      // se suelta, los avisos de la cuenta que se va aterrizan en la pantalla
      // de la que entra.
      const { error } = await supabase.from("profiles").update({ fcm_token: null }).eq("id", userId);
      if (error) reportarCuentas("soltar_token_push", error, "warning");
    },
    boveda: { guardar: guardarCuenta, quitar: quitarCuenta, buscar: buscarCuenta },
    marcar: marcarCambioEnCurso,
    desmarcar: desmarcarCambioEnCurso,
    reportar: reportarCuentas,
  };
}
