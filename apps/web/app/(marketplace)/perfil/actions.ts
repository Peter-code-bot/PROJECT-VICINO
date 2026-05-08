"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const updateProfileSchema = z.object({
  nombre: z.string().trim().min(1).max(100),
  bio: z.string().max(500).optional(),
  foto: z.string().url().max(500).optional().or(z.literal("")),
  ubicacion: z.string().max(200).optional(),
  es_vendedor: z.string().optional(),
  seller_type: z.enum(["casual", "business"]).optional(),
  nombre_negocio: z.string().max(200).optional(),
  descripcion_negocio: z.string().max(1000).optional(),
  metodos_pago_aceptados: z.string().max(500).optional(),
});

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Datos inválidos" };

  const {
    nombre,
    bio = null,
    foto = null,
    ubicacion = null,
    es_vendedor: esVendedorRaw,
    seller_type = "casual",
    nombre_negocio = null,
    descripcion_negocio = null,
    metodos_pago_aceptados = null,
  } = parsed.data;

  const es_vendedor = esVendedorRaw === "on";

  const { error } = await supabase
    .from("profiles")
    .update({
      nombre: nombre.trim(),
      bio: bio?.trim() || null,
      foto: foto?.trim() || null,
      ubicacion: ubicacion?.trim() || null,
      es_vendedor,
      seller_type: es_vendedor ? seller_type : "casual",
      nombre_negocio: es_vendedor ? (nombre_negocio?.trim() || null) : null,
      descripcion_negocio: es_vendedor ? (descripcion_negocio?.trim() || null) : null,
      metodos_pago_aceptados: es_vendedor ? (metodos_pago_aceptados?.trim() || null) : null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  // Phase 9: AFTER the profile commit, ensure no `disponible` products remain
  // for non-seller users. Idempotent — runs on every save where es_vendedor
  // is false, not just on the transition. This makes the action self-healing:
  // if a prior pause attempt failed (or the profile flip somehow happened
  // without pausing), the next save automatically cleans up. Returns success
  // when there are no rows to pause (UPDATE 0 affected is not an error).
  if (!es_vendedor) {
    const { error: pauseErr } = await supabase
      .from("products_services")
      .update({ estatus: "pausado" })
      .eq("creador_id", user.id)
      .eq("estatus", "disponible");
    if (pauseErr) {
      return {
        error: `Perfil actualizado, pero hubo un problema pausando productos: ${pauseErr.message}. Vuelve a guardar para reintentar.`,
      };
    }
  }

  revalidatePath("/perfil");
  revalidatePath("/seller/listings");
  return { success: true };
}
