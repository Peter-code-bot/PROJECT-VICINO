"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { updateProfileSchema } from "@vicino/shared";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Build raw input from FormData. Empty strings collapse to null because the
  // shared schema accepts string-or-null for optional fields, and downstream
  // (DB columns + RPC TEXT params) treats null as "not set".
  const seller_type_input = (formData.get("seller_type") as string) || "casual";
  const es_vendedor = formData.get("es_vendedor") === "on";

  const raw = {
    nombre: ((formData.get("nombre") as string) ?? "").trim(),
    bio: ((formData.get("bio") as string) ?? "").trim() || null,
    foto: ((formData.get("foto") as string) ?? "").trim() || null,
    ubicacion: ((formData.get("ubicacion") as string) ?? "").trim() || null,
    es_vendedor,
    seller_type: es_vendedor && seller_type_input === "business" ? "business" : "casual",
    nombre_negocio:
      es_vendedor && seller_type_input === "business"
        ? ((formData.get("nombre_negocio") as string) ?? "").trim() || null
        : null,
    descripcion_negocio:
      es_vendedor && seller_type_input === "business"
        ? ((formData.get("descripcion_negocio") as string) ?? "").trim() || null
        : null,
    metodos_pago_aceptados: es_vendedor
      ? ((formData.get("metodos_pago_aceptados") as string) ?? "").trim() || null
      : null,
  };

  const parsed = updateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // MP#07 Fase 2: profile update + product pause are atomic via RPC
  // `update_profile_and_pause_products`. The Postgres function runs in a
  // single transaction, so the divergent state (profile flipped but products
  // still `disponible`) is no longer reachable. The RPC also enforces
  // `auth.uid() = p_user_id` server-side via SECURITY DEFINER, so passing a
  // wrong id returns 42501.
  const { error } = await supabase.rpc("update_profile_and_pause_products", {
    p_user_id: user.id,
    p_nombre: parsed.data.nombre,
    p_bio: parsed.data.bio,
    p_foto: parsed.data.foto,
    p_ubicacion: parsed.data.ubicacion,
    p_es_vendedor: parsed.data.es_vendedor,
    p_seller_type: parsed.data.seller_type,
    p_nombre_negocio: parsed.data.nombre_negocio,
    p_descripcion_negocio: parsed.data.descripcion_negocio,
    p_metodos_pago_aceptados: parsed.data.metodos_pago_aceptados,
  });

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  revalidatePath("/seller/listings");
  return { success: true };
}

export async function updateProductsOrder(updates: { id: string; sort_order: number }[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Ejecutamos las actualizaciones en paralelo asegurándonos de que 
  // solo el creador pueda modificar sus productos.
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from("products_services")
        .update({ sort_order: update.sort_order })
        .eq("id", update.id)
        .eq("creador_id", user.id)
    )
  );

  const error = results.find((r) => r.error)?.error;
  if (error) return { error: error.message };

  revalidatePath("/perfil");
  return { success: true };
}
