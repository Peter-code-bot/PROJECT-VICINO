"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("usuario_id", user.id)
    .eq("producto_id", parsed.data.product_id)
    .maybeSingle();

  if (existing) {
    await supabase.from("favorites").delete().eq("id", existing.id);
  } else {
    await supabase
      .from("favorites")
      .insert({ usuario_id: user.id, producto_id: parsed.data.product_id });
  }

  revalidatePath("/favoritos");
  return { isFavorite: !existing };
}
