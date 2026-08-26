"use server";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { AVISO_PRIVACIDAD_VERSION } from "@vicino/shared";

/**
 * Deja constancia del consentimiento expreso para tratar datos biometricos.
 *
 * La selfie de verificacion es dato biometrico y por tanto SENSIBLE bajo la
 * LFPDPPP. El articulo 8 exige consentimiento EXPRESO y por escrito para datos
 * sensibles, no el tacito que basta para el resto. Una casilla sin registro no
 * acredita nada: si manana alguien pregunta, hace falta poder decir quien,
 * cuando y que version del Aviso acepto.
 *
 * La version NO llega del cliente: sale de la constante compartida, la misma
 * que muestra la pagina del Aviso. Si llegara del cliente, el usuario podria
 * declarar haber aceptado una version que nunca vio.
 *
 * La fecha tampoco: la pone el servidor con NOW() dentro del RPC. Un
 * consentimiento cuya fecha la escribe quien consiente no acredita gran cosa.
 */
export async function registrarConsentimientoBiometrico() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const h = await headers();
  // x-forwarded-for puede traer varias IP separadas por coma; la primera es la
  // del cliente. Si no hay nada utilizable se manda null: la IP es un dato de
  // apoyo, no la prueba. La prueba es la fila y su fecha.
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;

  const { data, error } = await supabase.rpc("registrar_consentimiento_biometrico", {
    p_aviso_version: AVISO_PRIVACIDAD_VERSION,
    p_user_agent: h.get("user-agent") ?? null,
    p_ip: ip,
  });

  if (error) {
    // Esto no puede fallar en silencio: sin la fila, la subida siguiente se
    // rechaza y el usuario no entenderia por que.
    Sentry.captureException(error, {
      tags: { action: "registrarConsentimientoBiometrico" },
    });
    return { error: "No se pudo registrar tu consentimiento. Intenta de nuevo." };
  }

  return { success: true as const, id: data as string };
}
