"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProductSchema } from "@vicino/shared";

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Validate
  const raw = {
    titulo: formData.get("titulo") as string,
    descripcion: formData.get("descripcion") as string,
    precio: Number(formData.get("precio")),
    tipo: formData.get("tipo") as string,
    categoria: formData.get("categoria") as string,
    ubicacion: (formData.get("ubicacion") as string) || undefined,
    tipo_entrega: (formData.get("tipo_entrega") as string) || "pickup",
  };

  const result = createProductSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const imagenPrincipal = (formData.get("imagen_principal") as string) || null;
  const galeriaRaw = formData.get("galeria_imagenes") as string;
  let galeriaImagenes: string[] = [];
  try {
    if (galeriaRaw) galeriaImagenes = JSON.parse(galeriaRaw);
  } catch {
    // ignore parse errors
  }

  const { data, error } = await supabase
    .from("products_services")
    .insert({
      creador_id: user.id,
      titulo: result.data.titulo,
      descripcion: result.data.descripcion,
      precio: result.data.precio,
      tipo: result.data.tipo,
      categoria: result.data.categoria,
      ubicacion: result.data.ubicacion ?? null,
      tipo_entrega: result.data.tipo_entrega,
      estatus: "disponible",
      imagen_principal: imagenPrincipal,
      galeria_imagenes: galeriaImagenes.length > 0 ? galeriaImagenes : [],
    })
    .select("slug, categoria")
    .single();

  if (error) {
    return { error: error.message };
  }

  redirect(`/${data.categoria}/${data.slug}`);
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const updates: Record<string, unknown> = {};
  const titulo = formData.get("titulo") as string;
  if (titulo) updates.titulo = titulo;
  const descripcion = formData.get("descripcion") as string;
  if (descripcion) updates.descripcion = descripcion;
  const precio = formData.get("precio");
  if (precio) updates.precio = Number(precio);
  const categoria = formData.get("categoria") as string;
  if (categoria) updates.categoria = categoria;
  const tipo_entrega = formData.get("tipo_entrega") as string;
  if (tipo_entrega) updates.tipo_entrega = tipo_entrega;
  const ubicacion = formData.get("ubicacion") as string;
  if (ubicacion) updates.ubicacion = ubicacion;

  const { error } = await supabase
    .from("products_services")
    .update(updates)
    .eq("id", id)
    .eq("creador_id", user.id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("products_services")
    .update({ estatus: "eliminado" })
    .eq("id", id)
    .eq("creador_id", user.id);

  if (error) {
    return { error: error.message };
  }

  redirect("/seller/listings");
}

export async function toggleProductStatus(id: string, newStatus: "disponible" | "pausado") {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("products_services")
    .update({ estatus: newStatus })
    .eq("id", id)
    .eq("creador_id", user.id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
