"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "@/lib/revalidate-session";
import { createClient } from "@/lib/supabase/server";
import { createLocalReviewSchema, type CreateLocalReviewInput } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { readSellerReviews } from "@/lib/reviews/read";
import { readSellerReviewsSchema, type OwnLocalReview, type SellerReviewsSnapshot } from "@/lib/reviews/contracts";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";

export type PublishLocalReviewResult =
  | { success: true; review: OwnLocalReview }
  | { success: false; error: string; code?: string };

export async function publishLocalReview(
  input: CreateLocalReviewInput,
  revalidateUrl?: string
): Promise<PublishLocalReviewResult> {
  const parsed = createLocalReviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.errors[0]?.message ?? "Datos inválidos",
      code: "INVALID_INPUT",
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError && authError.name !== "AuthSessionMissingError") {
      return { success: false, error: "Error de autenticación", code: "UNAVAILABLE" };
    }
    if (!user) {
      return { success: false, error: "Inicia sesión para continuar.", code: "UNAUTHENTICATED" };
    }

    if (user.id === parsed.data.reviewedId) {
      return { success: false, error: "No puedes calificarte a ti mismo.", code: "SELF_REVIEW" };
    }

    const rate = await enforce(writeRateLimit, `write:${user.id}`);
    if (!rate.ok) {
      return { success: false, error: rate.error, code: "RATE_LIMITED" };
    }

    const { data, error } = await supabase.rpc("publicar_resena_local", {
      p_reviewed_id: parsed.data.reviewedId,
      p_rating: parsed.data.rating,
      p_comentario: parsed.data.comentario ?? undefined,
    });

    if (error) {
      if (error.code === "42501") {
        return { success: false, error: "No tienes permiso para publicar reseñas.", code: "FORBIDDEN" };
      }
      if (error.code === "22023") {
        const msg = error.message.includes("calificarte")
          ? "No puedes calificarte a ti mismo."
          : "Revisa la calificación o comentario ingresado.";
        return { success: false, error: msg, code: "INVALID_INPUT" };
      }
      if (error.code === "PT404") {
        return { success: false, error: "El vendedor ya no está disponible.", code: "NOT_AVAILABLE" };
      }

      Sentry.captureException(error, {
        tags: { action: "publishLocalReview" },
        extra: {
          reviewedId: parsed.data.reviewedId,
          rating: parsed.data.rating,
          code: error.code,
          details: error.details,
        },
      });
      return { success: false, error: "No se pudo guardar la reseña. Inténtalo de nuevo.", code: "UNAVAILABLE" };
    }

    const result = z.object({ success: z.literal(true), review: z.object({
      id: z.string().uuid(), rating: z.number().int().min(1).max(5),
      comentario: z.string().nullable(), visible: z.boolean(), is_hidden: z.boolean(),
    }).passthrough() }).safeParse(data);
    if (!result.success) {
      return { success: false, error: "Respuesta inesperada al guardar la reseña.", code: "UNAVAILABLE" };
    }

    if (revalidateUrl && destinoAutenticadoSeguro(revalidateUrl) === revalidateUrl) {
      await revalidatePath(new URL(revalidateUrl, "https://vicino.invalid").pathname);
    }

    return {
      success: true,
      review: {
        id: result.data.review.id, rating: result.data.review.rating,
        comentario: result.data.review.comentario,
        visible: result.data.review.visible && !result.data.review.is_hidden,
      },
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: "publishLocalReview" } });
    return { success: false, error: "Ocurrió un error inesperado.", code: "INTERNAL_ERROR" };
  }
}

export async function loadSellerReviews(input: { sellerId: string; offset?: number }): Promise<
  { success: true; snapshot: SellerReviewsSnapshot } | { success: false; error: string }
> {
  const parsed = readSellerReviewsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Datos de reseñas inválidos." };
  try {
    const client = await createClient();
    const { error } = await client.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") throw error;
    return { success: true, snapshot: await readSellerReviews(client, parsed.data.sellerId, parsed.data.offset) };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: "loadSellerReviews" } });
    return { success: false, error: "No se pudieron cargar las reseñas. Inténtalo de nuevo." };
  }
}
