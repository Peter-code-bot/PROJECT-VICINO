"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { legalStateSchema } from "@/lib/auth/confirmacion-legal";

const confirmationSchema = z.object({
  expectedUserId: z.string().uuid(), terminosVersion: z.literal(TERMINOS_VERSION), avisoVersion: z.literal(AVISO_PRIVACIDAD_VERSION),
  aceptaTerminos: z.literal(true), acusaAviso: z.literal(true),
}).strict();

/** Compatibility with an older client. Visiting a page is not a confirmation. */
export async function registrarAceptacionLegal() {
  return { success: true as const, registradas: 0 };
}

export async function confirmarDocumentosCuenta(input: unknown) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Inicia sesión para confirmar tu cuenta." };
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) return { error: "Marca las dos casillas y revisa los documentos actuales." };
  if (parsed.data.expectedUserId !== user.id) return { error: "La cuenta cambió. Recarga antes de continuar." };
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };
  const { data, error } = await supabase.rpc("confirmar_documentos_cuenta", {
    p_terminos_version: parsed.data.terminosVersion, p_aviso_version: parsed.data.avisoVersion,
    p_acepta_terminos: true, p_acusa_aviso: true,
  });
  if (error) {
    if (error.code === "22023" && error.message === "Marca las dos casillas para continuar.")
      return { error: "Marca las dos casillas para continuar." };
    if (error.code === "22023" && error.message === "Los documentos cambiaron. Recarga y revisa las versiones actuales.")
      return { error: "Los documentos cambiaron. Recarga y revisa las versiones actuales." };
    if (error.code === "P0002")
      return { error: "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo." };
    Sentry.captureException(error, { tags: { action: "confirmar_documentos_cuenta" } });
    return { error: "No pudimos guardar tu confirmación. Intenta de nuevo." };
  }
  const state = legalStateSchema.safeParse(data);
  if (!state.success || !state.data.confirmed) return { error: "No pudimos comprobar tu confirmación. Intenta de nuevo." };
  return { success: true as const };
}
