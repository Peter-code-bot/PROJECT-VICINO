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

  // MP#07 Fase 2: profile update + product pause are now atomic via RPC
  // `update_profile_and_pause_products`. Postgres function = single
  // transaction, so the divergent state (profile flipped but products still
  // `disponible`) is no longer reachable. The RPC also enforces
  // `auth.uid() = user.id` server-side via SECURITY DEFINER, so passing a
  // wrong id returns 42501.
  const { error } = await supabase.rpc("update_profile_and_pause_products", {
    p_user_id: user.id,
    p_nombre: nombre.trim(),
    p_bio: bio?.trim() || null,
    p_foto: foto?.trim() || null,
    p_ubicacion: ubicacion?.trim() || null,
    p_es_vendedor: es_vendedor,
    p_seller_type: seller_type,
    p_nombre_negocio: nombre_negocio?.trim() || null,
    p_descripcion_negocio: descripcion_negocio?.trim() || null,
    p_metodos_pago_aceptados: metodos_pago_aceptados?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  revalidatePath("/seller/listings");
  return { success: true };
}
