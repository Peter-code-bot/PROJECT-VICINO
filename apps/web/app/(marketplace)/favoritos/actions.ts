"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { toggleFavoriteSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

const uuidSchema = z.string().uuid();

export async function toggleFavorite(productId: string) {
  if (!uuidSchema.safeParse(productId).success) return { error: "ID inválido" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = toggleFavoriteSchema.safeParse({ product_id: productId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Producto inválido" };
  }

  const { data: existing, error: lookupErr } = await supabase
    .from("favorites")
    .select("id")
    .eq("usuario_id", user.id)
    .eq("producto_id", parsed.data.product_id)
    .maybeSingle();

  // Si el SELECT falla, `existing` viene null y sin este guard caeriamos al
  // INSERT creyendo que no existe. Abortamos: el hook hace rollback del
  // corazon optimista en vez de mentirle al usuario.
  if (lookupErr) {
    Sentry.captureException(lookupErr, {
      tags: { action: "toggleFavorite", step: "lookup" },
      contexts: {
        favorite: { productId: parsed.data.product_id },
        supabase: { code: lookupErr.code },
      },
    });
    return { error: "No se pudo actualizar tus favoritos. Intenta de nuevo." };
  }

  if (existing) {
    // 0 filas borradas NO es error: significa que otra pestaña ya lo quito y
    // el estado final que reportamos (false) sigue siendo el correcto.
    const { error: deleteErr } = await supabase
      .from("favorites")
      .delete()
      .eq("id", existing.id);

    if (deleteErr) {
      Sentry.captureException(deleteErr, {
        tags: { action: "toggleFavorite", step: "delete" },
        contexts: {
          favorite: { productId: parsed.data.product_id },
          supabase: { code: deleteErr.code },
        },
      });
      return { error: "No se pudo quitar de favoritos. Intenta de nuevo." };
    }
  } else {
    const { error: insertErr } = await supabase
      .from("favorites")
      .insert({ usuario_id: user.id, producto_id: parsed.data.product_id });

    // 23505 = favorites_usuario_id_producto_id_key. El SELECT de arriba y este
    // INSERT no son atomicos: un doble toque o dos pestañas pueden leer "no
    // existe" a la vez e insertar ambas. El UNIQUE es sobre
    // (usuario_id, producto_id), asi que la fila que colisiona es de ESTE
    // usuario y ESTE producto: el estado final deseado ya se cumple. Es exito
    // idempotente, no error — reportarlo despintaria un corazon que si esta
    // guardado. Cualquier otro codigo (42501, RLS, red) si aborta.
    if (insertErr && insertErr.code !== "23505") {
      Sentry.captureException(insertErr, {
        tags: { action: "toggleFavorite", step: "insert" },
        contexts: {
          favorite: { productId: parsed.data.product_id },
          supabase: { code: insertErr.code },
        },
      });
      return { error: "No se pudo agregar a favoritos. Intenta de nuevo." };
    }
  }

  revalidatePath("/favoritos");
  return { isFavorite: !existing };
}
