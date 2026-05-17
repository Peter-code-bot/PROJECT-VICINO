"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createProductSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

const PRODUCT_MEDIA_PREFIX = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-media/`
  : null;

function isValidProductMediaUrl(url: string): boolean {
  if (!PRODUCT_MEDIA_PREFIX) return false;
  return typeof url === "string" && url.startsWith(PRODUCT_MEDIA_PREFIX);
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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

  const ubicLat = formData.get("ubicacion_lat") ? Number(formData.get("ubicacion_lat")) : null;
  const ubicLng = formData.get("ubicacion_lng") ? Number(formData.get("ubicacion_lng")) : null;
  const deliveryRadius = formData.get("delivery_radius_km") ? Number(formData.get("delivery_radius_km")) : 5;

  const allowAppointments = formData.get("allow_appointments") === "true";
  const appointmentStartTime = (formData.get("appointment_start_time") as string) || "09:00";
  const appointmentEndTime = (formData.get("appointment_end_time") as string) || "18:00";
  const appointmentDurationMinutes = formData.get("appointment_duration_minutes") ? Number(formData.get("appointment_duration_minutes")) : 60;

  const imagenPrincipal = (formData.get("imagen_principal") as string) || null;
  const galeriaRaw = formData.get("galeria_imagenes") as string;
  let galeriaImagenes: string[] = [];
  try {
    if (galeriaRaw) {
      const parsedGallery = JSON.parse(galeriaRaw);
      if (Array.isArray(parsedGallery)) {
        galeriaImagenes = parsedGallery.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // ignore parse errors
  }

  // Allowlist: only accept URLs pointing to our product-media bucket.
  if (imagenPrincipal && !isValidProductMediaUrl(imagenPrincipal)) {
    return { error: "URL de imagen principal inválida" };
  }
  if (galeriaImagenes.some((u) => !isValidProductMediaUrl(u))) {
    return { error: "Una o más URLs de la galería son inválidas" };
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
      delivery_radius_km: deliveryRadius,
      allow_appointments: allowAppointments,
      appointment_start_time: allowAppointments ? appointmentStartTime : null,
      appointment_end_time: allowAppointments ? appointmentEndTime : null,
      appointment_duration_minutes: allowAppointments ? appointmentDurationMinutes : null,
      ...(ubicLat && ubicLng
        ? { ubicacion_geo: `SRID=4326;POINT(${ubicLng} ${ubicLat})` }
        : {}),
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

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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
