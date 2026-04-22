"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const nombre = (formData.get("nombre") as string)?.trim();
  const bio = (formData.get("bio") as string)?.trim() || null;
  const foto = (formData.get("foto") as string)?.trim() || null;
  const ubicacion = (formData.get("ubicacion") as string)?.trim() || null;
  const es_vendedor = formData.get("es_vendedor") === "on";
  const seller_type = (formData.get("seller_type") as string) || "casual";
  const nombre_negocio = seller_type === "business" ? ((formData.get("nombre_negocio") as string)?.trim() || null) : null;
  const descripcion_negocio = seller_type === "business" ? ((formData.get("descripcion_negocio") as string)?.trim() || null) : null;
  const metodos_pago_aceptados = (formData.get("metodos_pago_aceptados") as string)?.trim() || null;

  if (!nombre || nombre.length < 1) {
    return { error: "El nombre es obligatorio" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      nombre,
      bio,
      foto,
      ubicacion,
      es_vendedor,
      seller_type: es_vendedor ? seller_type : "casual",
      nombre_negocio: es_vendedor ? nombre_negocio : null,
      descripcion_negocio: es_vendedor ? descripcion_negocio : null,
      metodos_pago_aceptados: es_vendedor ? metodos_pago_aceptados : null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  return { success: true };
}
