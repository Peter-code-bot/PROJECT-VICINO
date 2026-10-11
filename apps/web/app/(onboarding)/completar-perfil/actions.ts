"use server";

import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { usernameSchema } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { PASOS_ONBOARDING, type PasoOnboarding } from "@/lib/onboarding/steps";

export type { PasoOnboarding } from "@/lib/onboarding/steps";
export type CaminoOnboarding = "explorar" | "vender";

export interface GuardarPasoInput {
  camino?: CaminoOnboarding;
  /** El siguiente paso pendiente, persistido junto con el dato actual. */
  paso?: PasoOnboarding;
  username?: string;
  nombre?: string;
  bio?: string;
  foto?: string;
  intereses?: string[];
  categoria_negocio?: string;
  seller_type?: "casual" | "business";
  nombre_negocio?: string;
  descripcion_negocio?: string;
  metodos_pago_aceptados?: string;
}

const guardarPasoSchema = z.object({
  camino: z.enum(["explorar", "vender"]).optional(),
  paso: z.string().refine(
    (paso) => paso === "perfil" || PASOS_ONBOARDING.some((actual) => actual === paso),
    "Paso de onboarding inválido.",
  ).optional(),
  username: usernameSchema.optional(),
  nombre: z.string().trim().min(2, "Escribe al menos 2 caracteres.").max(60, "Máximo 60 caracteres.").optional(),
  bio: z.string().trim().min(1, "Escribe una descripción o elige Omitir.").max(160, "Máximo 160 caracteres.").optional(),
  foto: z.string().url("Esa foto no es válida.").regex(/^https?:\/\/\S+$/, "Esa foto no es válida.").max(500).optional(),
  intereses: z.array(z.string().min(1).max(80)).min(1, "Elige entre 1 y 5 intereses.").max(5, "Elige entre 1 y 5 intereses.").optional(),
  categoria_negocio: z.string().min(1, "Elige una categoría.").max(80).optional(),
  seller_type: z.enum(["casual", "business"]).optional(),
  nombre_negocio: z.string().trim().min(2, "Escribe al menos 2 caracteres.").max(100, "Máximo 100 caracteres.").optional(),
  descripcion_negocio: z.string().trim().min(1, "Escribe una descripción o elige Omitir.").max(1000, "Máximo 1000 caracteres.").optional(),
  metodos_pago_aceptados: z.string().trim().min(1, "Elige cómo aceptas pagos o elige Omitir.").max(500).optional(),
}).strict();

/**
 * Guarda UN paso del onboarding sin tocar lo que guardaron los anteriores.
 *
 * Va por RPC y no por un update normal porque `authenticated` solo tiene
 * UPDATE sobre (foto, fcm_token) en profiles — los privilegios de esa tabla se
 * dan columna por columna. Nombre, bio e intereses son inalcanzables desde el
 * cliente por cualquier otra via.
 *
 * El COALESCE vive dentro del RPC v2: omitir un campo
 * significa «no lo toques», nunca «borralo». Es lo que permite que el paso 3
 * llame sin mandar lo del paso 2.
 */
export async function guardarPasoOnboarding(input: GuardarPasoInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // La misma cuota que usa el resto de escrituras del repo (chat, publicar,
  // favoritos). Esto es una server action, o sea un endpoint HTTP alcanzable
  // sin pasar por la pantalla, y escribe en profiles a traves de un
  // SECURITY DEFINER. Quedarse fuera del patron no tenia ninguna razon: era el
  // unico endpoint de escritura del onboarding sin freno.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // La entrada es un endpoint: TypeScript y maxLength no validan una petición.
  const parsed = guardarPasoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa la información de este paso." };
  }
  const datos = parsed.data;

  // El username, los borradores de vendedor y el avance se guardan en una
  // transacción. Este RPC no activa es_vendedor ni cambia el ID interno.
  const { data, error } = await supabase.rpc("guardar_paso_onboarding_v2", {
    p_camino: datos.camino,
    p_paso: datos.paso,
    p_username: datos.username,
    p_nombre: datos.nombre,
    p_bio: datos.bio,
    p_foto: datos.foto,
    p_intereses: datos.intereses,
    p_categoria_negocio: datos.categoria_negocio,
    p_seller_type: datos.seller_type,
    p_nombre_negocio: datos.nombre_negocio,
    p_descripcion_negocio: datos.descripcion_negocio,
    p_metodos_pago_aceptados: datos.metodos_pago_aceptados,
  });

  if (error) {
    if (error.code === "22023" || error.code === "23505") return { error: error.message };
    // El detalle tecnico se queda en el servidor. Postgres nombra la columna o
    // la policy que rechazo en `details`, y perderlo obliga a diagnosticar a
    // ciegas — ya paso con el 42501 de modo_precio.
    Sentry.captureException(error, {
      tags: { action: "guardar_paso_onboarding_v2" },
      contexts: { supabase: { code: error.code, details: error.details } },
    });

    if (error.code === "P0002") {
      return {
        error:
          "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo; si persiste, contáctanos.",
      };
    }
    return { error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
  }

  await revalidatePath("/completar-perfil", "layout");
  await revalidatePath("/perfil");
  return { success: true, data };
}
