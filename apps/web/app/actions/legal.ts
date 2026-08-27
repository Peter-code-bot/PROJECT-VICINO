"use server";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";

/**
 * Deja constancia de la aceptacion tacita de los documentos legales vigentes.
 *
 * POR QUE ES TACITA Y NO UNA CASILLA. No es una comodidad que nos tomemos: el
 * Aviso publicado dice en su seccion 19 que "la utilizacion de la Plataforma
 * con posterioridad a la publicacion... constituye ACEPTACION TACITA de su
 * contenido". Lo que faltaba no era el consentimiento, era la CONSTANCIA. Sin
 * fila, la afirmacion "el usuario acepto la version 2.2" no se puede sostener
 * ante nadie.
 *
 * La casilla expresa se reserva para lo que de verdad la exige: los datos
 * biometricos de la verificacion, donde el articulo 8 de la LFPDPPP pide
 * consentimiento expreso y por escrito. Eso ya vive aparte, en
 * registrarConsentimientoBiometrico.
 *
 * Ni la fecha, ni la version, ni el usuario llegan del cliente: los tres los
 * pone el RPC desde el servidor. Un registro cuya fecha elige quien consiente
 * no acredita gran cosa.
 *
 * Es idempotente por construccion (ON CONFLICT DO NOTHING sobre user+documento+
 * version), asi que llamarla de mas no ensucia nada: lo que se acredita es la
 * PRIMERA vez que la persona uso la plataforma bajo esa version.
 */
export async function registrarAceptacionLegal() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const h = await headers();
  // x-forwarded-for puede traer varias IP separadas por coma; la primera es la
  // del cliente. Es un dato de apoyo, no la prueba: si viene inservible, el RPC
  // la descarta y registra igual.
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;

  const { data, error } = await supabase.rpc("registrar_aceptacion_legal", {
    p_modo: "uso_continuado",
    p_user_agent: h.get("user-agent") ?? null,
    p_ip: ip,
  });

  if (error) {
    // No se le enseña al usuario: esto es contabilidad interna y bloquear la
    // navegacion por ello seria peor que el problema. Pero tampoco puede
    // perderse: un registro legal que falla en silencio es exactamente el modo
    // de fallo que este mecanismo viene a cerrar.
    Sentry.captureException(error, {
      tags: { action: "registrarAceptacionLegal" },
      extra: { code: error.code, details: error.details, hint: error.hint },
    });
    return { error: "No se pudo registrar la aceptación" };
  }

  // Filas devueltas = versiones que se registraron AHORA. Vacio significa que
  // ya estaban, que es el caso normal a partir de la segunda visita.
  return { success: true as const, registradas: (data ?? []).length };
}
