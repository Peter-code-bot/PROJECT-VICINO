"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { loyaltyEnrollSchema, loyaltyRedeemStartSchema } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { enforce, walletEmitRateLimit, writeRateLimit } from "@/lib/rate-limit";
import { conLealtad } from "@/types/loyalty.types";
import { mensajeDeErrorLealtad } from "@/lib/lealtad/errores";
import { canjeSchema, inscripcionSchema, pasePreparadoSchema } from "@/lib/lealtad/esquemas";
import { configWallet } from "@/lib/wallet/config";
import { asegurarClaseGoogle, asegurarObjetoGoogle, enlaceGuardarGoogle, idsGoogle } from "@/lib/wallet/google/api";

/**
 * TODA exportacion de este archivo es un endpoint HTTP publico: solo funciones
 * async. La identidad la pone la base (auth.uid()).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reportar(accion: string, error: { code?: string; details?: string; hint?: string }) {
  Sentry.captureException(error, {
    tags: { action: accion },
    contexts: { supabase: { code: error.code, details: error.details, hint: error.hint } },
  });
}

/** La RPC contesto algo que el esquema no reconoce: deriva de contrato, no error de la persona. */
function formaInesperada(accion: string): { error: string } {
  Sentry.captureMessage(`${accion}: la RPC devolvio una forma inesperada`, { level: "error", tags: { action: accion } });
  return { error: "No se pudo leer la respuesta. Actualiza la página." };
}

async function sesionConCuota(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Inicia sesión para continuar." };
  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };
  return { supabase, userId: user.id };
}

export async function inscribirse(programId: string): Promise<{ membershipId?: string; error?: string }> {
  const parseado = loyaltyEnrollSchema.safeParse({ programId });
  if (!parseado.success) return { error: "Programa inválido." };
  const sesion = await sesionConCuota();
  if ("error" in sesion) return { error: sesion.error };

  const { data, error } = await conLealtad(sesion.supabase).rpc("loyalty_inscribirse", { p_program_id: parseado.data.programId });
  if (error) {
    if (error.code !== "PT404" && error.code !== "PT409") reportar("inscribirse", error);
    return { error: mensajeDeErrorLealtad(error) };
  }
  const resultado = inscripcionSchema.safeParse(data);
  if (!resultado.success) return formaInesperada("inscribirse");
  revalidatePath("/tarjetas");
  revalidatePath(`/vendedor/${resultado.data.program.seller_id}`);
  return { membershipId: resultado.data.membership.id };
}

export async function iniciarCanje(
  membershipId: string,
  clave: string,
): Promise<{ canje?: { id: string; codigo: string; expires_at: string; premio: string }; error?: string }> {
  const parseado = loyaltyRedeemStartSchema.safeParse({ membershipId, clave });
  if (!parseado.success) return { error: "Datos inválidos." };
  const sesion = await sesionConCuota();
  if ("error" in sesion) return { error: sesion.error };

  const { data, error } = await conLealtad(sesion.supabase).rpc("loyalty_canje_iniciar", {
    p_membership_id: parseado.data.membershipId,
    p_clave: parseado.data.clave,
  });
  if (error) {
    if (error.code !== "PT404" && error.code !== "PT409") reportar("iniciarCanje", error);
    return { error: mensajeDeErrorLealtad(error) };
  }
  const resultado = canjeSchema.safeParse(
    data && typeof data === "object" && "redemption" in data ? (data as { redemption: unknown }).redemption : null,
  );
  if (!resultado.success) return formaInesperada("iniciarCanje");
  revalidatePath(`/tarjetas/${parseado.data.membershipId}`);
  const { id, codigo, expires_at, premio } = resultado.data;
  return { canje: { id, codigo, expires_at, premio } };
}

export async function cancelarCanje(redemptionId: string, membershipId: string): Promise<{ success?: true; error?: string }> {
  if (!UUID.test(redemptionId) || !UUID.test(membershipId)) return { error: "Datos inválidos." };
  const sesion = await sesionConCuota();
  if ("error" in sesion) return { error: sesion.error };

  const { error } = await conLealtad(sesion.supabase).rpc("loyalty_canje_cancelar", { p_redemption_id: redemptionId });
  if (error) {
    if (error.code !== "PT404") reportar("cancelarCanje", error);
    return { error: mensajeDeErrorLealtad(error) };
  }
  revalidatePath(`/tarjetas/${membershipId}`);
  return { success: true };
}

/**
 * Enlace "Add to Google Wallet". El servidor crea o actualiza la clase y el
 * objeto con la cuenta de servicio y firma un JWT con solo los ids; el
 * telefono termina el guardado con la cuenta de Google de la persona.
 */
export async function enlaceGoogleWallet(membershipId: string): Promise<{ url?: string; error?: string }> {
  if (!UUID.test(membershipId)) return { error: "Tarjeta inválida." };
  const config = configWallet();
  if (!config.google) return { error: "Google Wallet todavía no está disponible en VICINO." };
  const sesion = await sesionConCuota();
  if ("error" in sesion) return { error: sesion.error };
  // Cubo aparte: cada clic son hasta cuatro llamadas a la API de Google con la cuota del proyecto.
  const emision = await enforce(walletEmitRateLimit, `wallet:${sesion.userId}`);
  if (!emision.ok) return { error: emision.error };
  const cliente = conLealtad(sesion.supabase);

  const primero = await cliente.rpc("wallet_pase_preparar", { p_membership_id: membershipId, p_proveedor: "google" });
  if (primero.error) {
    if (primero.error.code !== "PT404") reportar("enlaceGoogleWallet", primero.error);
    return { error: mensajeDeErrorLealtad(primero.error) };
  }
  const preparado = pasePreparadoSchema.safeParse(primero.data);
  if (!preparado.success) return formaInesperada("enlaceGoogleWallet");

  const ids = idsGoogle(config.google, preparado.data.snapshot.program.id, membershipId);
  if (preparado.data.pass.class_id !== ids.classId || preparado.data.pass.object_id !== ids.objectId) {
    const segundo = await cliente.rpc("wallet_pase_preparar", {
      p_membership_id: membershipId,
      p_proveedor: "google",
      p_class_id: ids.classId,
      p_object_id: ids.objectId,
    });
    if (segundo.error) {
      reportar("enlaceGoogleWallet", segundo.error);
      return { error: mensajeDeErrorLealtad(segundo.error) };
    }
  }

  try {
    await asegurarClaseGoogle(config.google, preparado.data.snapshot, ids, config.siteUrl);
    await asegurarObjetoGoogle(config.google, preparado.data.snapshot, ids);
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "enlaceGoogleWallet", paso: "api" } });
    return { error: "Google Wallet no respondió. Inténtalo de nuevo en un momento." };
  }
  revalidatePath(`/tarjetas/${membershipId}`);
  return { url: enlaceGuardarGoogle(config.google, ids.objectId, config.siteUrl) };
}
