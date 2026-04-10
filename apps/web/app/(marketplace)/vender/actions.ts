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

  // Upload image to Supabase Storage (fire before INSERT)
  let imagen_principal: string | null = null;
  const imageFile = formData.get("imagen_principal") as File | null;
  if (imageFile && imageFile.size > 0) {
    const ext = imageFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("product-media")
      .upload(path, imageFile, {
        contentType: imageFile.type,
        upsert: false,
      });
    if (!uploadError) {
      const {
        data: { publicUrl },
      } = supabase.storage.from("product-media").getPublicUrl(path);
      imagen_principal = publicUrl;
    }
    // If upload fails, continue without image (non-blocking)
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
      imagen_principal,
      estatus: "disponible",
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
