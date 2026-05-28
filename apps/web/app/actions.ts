"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function toggleFollowStore(storeId: string, currentFollowingState: boolean) {
  if (!storeId || typeof storeId !== "string") {
    return { error: "ID de tienda inválido" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "No autenticado" };
  }

  const rate = await enforce(writeRateLimit, `follow:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  if (currentFollowingState) {
    // Unfollow
    const { error } = await supabase
      .from("store_follows")
      .delete()
      .match({ follower_id: user.id, store_id: storeId });
    if (error) return { error: error.message };
  } else {
    // Follow
    const { error } = await supabase
      .from("store_follows")
      .insert({ follower_id: user.id, store_id: storeId });
    if (error) return { error: error.message };
  }

  revalidatePath(`/vendedor/${storeId}`);
  revalidatePath("/");
  
  return { success: true };
}
