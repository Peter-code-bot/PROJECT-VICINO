"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateProfileSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const seller_type = (formData.get("seller_type") as string) || "casual";
  const es_vendedor = formData.get("es_vendedor") === "on";

  const raw = {
    nombre: ((formData.get("nombre") as string) ?? "").trim(),
    bio: ((formData.get("bio") as string) ?? "").trim() || null,
    foto: ((formData.get("foto") as string) ?? "").trim() || null,
    ubicacion: ((formData.get("ubicacion") as string) ?? "").trim() || null,
    es_vendedor,
    seller_type: es_vendedor && seller_type === "business" ? "business" : "casual",
    nombre_negocio:
      es_vendedor && seller_type === "business"
        ? ((formData.get("nombre_negocio") as string) ?? "").trim() || null
        : null,
    descripcion_negocio:
      es_vendedor && seller_type === "business"
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

  const { error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  return { success: true };
}
