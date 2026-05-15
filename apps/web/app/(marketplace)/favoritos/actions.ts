"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toggleFavoriteSchema } from "@vicino/shared";

export async function toggleFavorite(productId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

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
