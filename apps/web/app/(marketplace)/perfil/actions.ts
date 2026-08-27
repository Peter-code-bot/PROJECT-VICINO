"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { updateProfileSchema, usernameSchema } from "@vicino/shared";

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
    // `?? undefined` y no `?? null`: JSON.stringify descarta las claves
    // undefined, asi que PostgREST omite el parametro y Postgres aplica su
    // DEFAULT NULL (migracion 20260826390000). Misma columna, mismo valor,
    // sin el cast que haria falta para mandar null — el codegen de Supabase
    // no sabe declarar un argumento nulable.
    p_bio: parsed.data.bio ?? undefined,
    p_foto: parsed.data.foto ?? undefined,
    p_ubicacion: parsed.data.ubicacion ?? undefined,
    p_es_vendedor: parsed.data.es_vendedor,
    p_seller_type: parsed.data.seller_type ?? undefined,
    p_nombre_negocio: parsed.data.nombre_negocio ?? undefined,
    p_descripcion_negocio: parsed.data.descripcion_negocio ?? undefined,
    p_metodos_pago_aceptados: parsed.data.metodos_pago_aceptados ?? undefined,
  });

  if (error) return { error: error.message };

  revalidatePath("/perfil");
  revalidatePath("/seller/listings");
  return { success: true };
}

/**
 * Cambia el @ publico del usuario.
 *
 * Va por su propio RPC y no por update_profile_and_pause_products porque sus
 * fallos son distintos y la interfaz tiene que poder distinguirlos: "ya esta
 * en uso" y "esta reservado" piden que el usuario escriba otra cosa, no que
 * reintente. Los mensajes vienen ya redactados desde la base, asi que se
 * pasan tal cual en vez de traducir codigos aqui y alla.
 */
export async function setUsername(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = usernameSchema.safeParse(formData.get("username") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Nombre de usuario invalido" };
  }

  const { data, error } = await supabase.rpc("set_username", {
    p_username: parsed.data,
  });

  if (error) {
    // 22023 (formato o reservado) y 23505 (en uso) son del usuario, no fallos:
    // no ensucian Sentry. Cualquier otro codigo si es un fallo de verdad.
    if (error.code !== "22023" && error.code !== "23505") {
      Sentry.captureException(error, { tags: { action: "setUsername" } });
    }
    return { error: error.message };
  }

  revalidatePath("/perfil");
  return { success: true, username: data as string };
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
  if (error) {
    // El `details` de Postgres es donde el motor nombra la columna o la policy
    // que rechazo; se va a Sentry ANTES del return, que es donde sirve. Al
    // usuario le llega una frase, no un mensaje de PostgREST en ingles.
    Sentry.captureException(error, {
      tags: { action: "updateProductsOrder" },
      contexts: {
        order: { items: updates.length },
        supabase: { code: error.code },
      },
    });
    return { error: "No se pudo guardar el nuevo orden. Intenta de nuevo." };
  }

  revalidatePath("/perfil");
  return { success: true };
}

export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase.rpc("complete_user_onboarding");

  if (error) {
    console.error("[completeOnboarding] RPC error:", error.code, error.message);
    // P0002: no profiles row for the caller (raised by the anti-loop RPC).
    // Keep the technical detail in the server log, not in the toast.
    if (error.code === "P0002") {
      return {
        error:
          "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo; si persiste, contáctanos.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/");
  return { success: true };
}
