"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

/**
 * Activa el Modo Vendedor. Es el único gesto que convierte.
 *
 * Va por el RPC `activar_modo_vendedor` y no por el formulario de perfil por
 * dos motivos comprobados, no supuestos:
 *
 *   1. `authenticated` NO tiene UPDATE sobre es_vendedor, seller_type ni
 *      categoria_negocio — solo INSERT y SELECT. Sin RPC no se escribe nada.
 *   2. `update_profile_and_pause_products`, que sí escribe es_vendedor, hace
 *      sobrescritura completa del perfil y exige nombre, bio, foto y ubicación.
 *      Llamarlo desde aquí borraría todo lo demás.
 *
 * Y no es cosmético: la policy «Sellers can create products» exige
 * es_vendedor = true, así que hasta este momento la persona no puede publicar.
 */
export async function activarModoVendedor(params: {
  categoria: string | null;
  tipo: "casual" | "business";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase.rpc("activar_modo_vendedor", {
    p_categoria_negocio: params.categoria,
    p_seller_type: params.tipo,
  });

  if (error) {
    // 22023 es entrada inválida del usuario (categoría o tipo), no un fallo:
    // no ensucia Sentry. Cualquier otro código sí lo es.
    if (error.code !== "22023") {
      Sentry.captureException(error, { tags: { action: "activarModoVendedor" } });
    }
    return { error: error.message };
  }

  // El perfil y el propio alta cambian de estado: las dos vistas se rehacen.
  revalidatePath("/perfil");
  revalidatePath("/vender");
  return { success: true as const };
}

/**
 * Mueve el marcador del alta, o lo cierra pasando `null`.
 *
 * Existe aparte de la activación porque los pasos posteriores son omitibles y
 * la persona puede salir en cualquiera: hace falta mover el marcador sin volver
 * a tocar es_vendedor.
 */
export async function avanzarAltaVendedor(paso: "ubicacion" | "publicacion" | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { error } = await supabase.rpc("avanzar_alta_vendedor", { p_paso: paso });

  if (error) {
    Sentry.captureException(error, { tags: { action: "avanzarAltaVendedor" } });
    return { error: error.message };
  }

  revalidatePath("/perfil");
  return { success: true as const };
}
