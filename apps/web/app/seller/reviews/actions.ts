"use server";

import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { respondReviewSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function respondToReview(reviewId: string, respuesta: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = respondReviewSchema.safeParse({ review_id: reviewId, respuesta });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { data: updated, error: updateErr } = await supabase
    .from("reviews")
    .update({
      respuesta: parsed.data.respuesta,
      respuesta_fecha: new Date().toISOString(),
    })
    .eq("id", parsed.data.review_id)
    .eq("reviewed_id", user.id)
    .select("id")
    .maybeSingle();

  if (updateErr) {
    // Sentry SIEMPRE primero: el `details` de Postgres es donde el motor nombra
    // la columna o la policy que rechazo. Antes se devolvia error.message crudo
    // al vendedor y no quedaba ningun rastro del fallo del lado del servidor.
    Sentry.captureException(updateErr, {
      tags: { action: "respondToReview" },
      contexts: {
        review: { id: parsed.data.review_id },
        supabase: { code: updateErr.code },
      },
    });
    return { error: "No se pudo publicar tu respuesta. Intenta de nuevo." };
  }

  // Un UPDATE de 0 filas no es un error en PostgREST (204 sin cuerpo). La policy
  // `Reviewed user can respond` filtra por reviewed_id, asi que una resena de
  // otro vendedor o un id ya borrado no lanzan 42501: simplemente no tocan nada.
  // Sin este chequeo devolviamos exito y la respuesta nunca se guardaba.
  if (!updated) {
    return { error: "Esta reseña ya no está disponible. Actualiza la página e intenta de nuevo." };
  }

  return { success: true };
}
