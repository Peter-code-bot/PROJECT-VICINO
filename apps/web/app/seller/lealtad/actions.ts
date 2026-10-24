"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  loyaltyConfirmRedemptionSchema,
  loyaltyProgramSchema,
  loyaltyProgramStatusSchema,
  loyaltyReverseEventSchema,
} from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { conLealtad } from "@/types/loyalty.types";
import { mensajeDeErrorLealtad } from "@/lib/lealtad/errores";
import { programaSchema, resultadoCanjeSchema } from "@/lib/lealtad/esquemas";
import { drenarColaWallet } from "@/lib/wallet/sincronizar";

/**
 * TODA exportacion de este archivo es un endpoint HTTP publico: solo funciones
 * async, sin tipos ni constantes exportadas. La identidad la pone la base
 * (auth.uid()); aqui solo se valida la forma y se aplica la cuota.
 */

function reportar(accion: string, error: { code?: string; details?: string; hint?: string }, extra?: Record<string, unknown>) {
  Sentry.captureException(error, {
    tags: { action: accion },
    contexts: { supabase: { code: error.code, details: error.details, hint: error.hint }, lealtad: extra ?? {} },
  });
}

export async function guardarPrograma(formData: FormData): Promise<{ error: string } | undefined> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/seller/lealtad");

  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };

  const entrada = loyaltyProgramSchema.safeParse({
    nombre: formData.get("nombre"),
    premio: formData.get("premio"),
    meta_sellos: formData.get("meta_sellos"),
    condiciones: formData.get("condiciones") ?? undefined,
    color: formData.get("color"),
    plantilla: formData.get("plantilla"),
  });
  if (!entrada.success) {
    return { error: entrada.error.issues[0]?.message ?? "Revisa los datos del programa" };
  }

  const { data, error } = await conLealtad(supabase).rpc("loyalty_programa_guardar", {
    p_nombre: entrada.data.nombre,
    p_premio: entrada.data.premio,
    p_meta_sellos: entrada.data.meta_sellos,
    ...(entrada.data.condiciones ? { p_condiciones: entrada.data.condiciones } : {}),
    p_color: entrada.data.color,
    p_plantilla: entrada.data.plantilla,
  });
  if (error) {
    reportar("guardarPrograma", error);
    return { error: mensajeDeErrorLealtad(error) };
  }
  const programa = programaSchema.safeParse(data);
  revalidatePath("/seller/lealtad");
  if (programa.success) revalidatePath(`/vendedor/${programa.data.seller_id}`);
  redirect("/seller/lealtad");
}

export async function cambiarEstadoPrograma(estado: string): Promise<{ success?: true; error?: string }> {
  const parseado = loyaltyProgramStatusSchema.safeParse(estado);
  if (!parseado.success) return { error: "Ese cambio de estado no es posible." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };

  const { error } = await conLealtad(supabase).rpc("loyalty_programa_estado", { p_estado: parseado.data });
  if (error) {
    reportar("cambiarEstadoPrograma", error, { estado });
    return { error: mensajeDeErrorLealtad(error) };
  }
  revalidatePath("/seller/lealtad");
  revalidatePath(`/vendedor/${user.id}`);
  return { success: true };
}

export async function confirmarCanje(
  codigo: string,
): Promise<{ success?: true; cliente?: string; premio?: string; repetido?: boolean; error?: string }> {
  const parseado = loyaltyConfirmRedemptionSchema.safeParse({ codigo });
  if (!parseado.success) return { error: parseado.error.issues[0]?.message ?? "Código inválido" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };

  const { data, error } = await conLealtad(supabase).rpc("loyalty_canje_confirmar", { p_codigo: parseado.data.codigo });
  if (error) {
    // Un codigo equivocado es rutina de caja, no un incidente: solo se reporta lo inesperado.
    if (error.code !== "PT404" && error.code !== "PT409") reportar("confirmarCanje", error);
    return { error: mensajeDeErrorLealtad(error) };
  }
  const resultado = resultadoCanjeSchema.safeParse(data);
  if (!resultado.success) {
    Sentry.captureMessage("loyalty_canje_confirmar devolvio una forma inesperada", { level: "error", tags: { action: "confirmarCanje" } });
    return { error: "No se pudo leer la respuesta. Actualiza la página." };
  }
  revalidatePath("/seller/lealtad");
  // El saldo cambio: los pases se actualizan ahora, no en el cron diario.
  after(() => drenarColaWallet());
  return {
    success: true,
    cliente: resultado.data.cliente,
    premio: resultado.data.redemption.premio,
    repetido: resultado.data.repeated,
  };
}

export async function revertirEvento(eventId: string, motivo?: string): Promise<{ success?: true; error?: string }> {
  const parseado = loyaltyReverseEventSchema.safeParse({ eventId, motivo });
  if (!parseado.success) return { error: parseado.error.issues[0]?.message ?? "Datos inválidos" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };

  const { error } = await conLealtad(supabase).rpc("loyalty_revertir_evento", {
    p_event_id: parseado.data.eventId,
    ...(parseado.data.motivo ? { p_motivo: parseado.data.motivo } : {}),
  });
  if (error) {
    if (error.code !== "PT409") reportar("revertirEvento", error, { eventId });
    return { error: mensajeDeErrorLealtad(error) };
  }
  revalidatePath("/seller/lealtad");
  after(() => drenarColaWallet());
  return { success: true };
}

/** Repite el sello de una venta propia cuyo disparador fallo (lista "ventas sin sello"). */
export async function selloDesdeVenta(saleId: string): Promise<{ success?: true; motivo?: string; error?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)) return { error: "Venta inválida." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const cuota = await enforce(writeRateLimit, `write:${user.id}`);
  if (!cuota.ok) return { error: cuota.error };

  const { data, error } = await conLealtad(supabase).rpc("loyalty_sello_desde_venta", { p_sale_id: saleId });
  if (error) {
    if (error.code !== "PT404") reportar("selloDesdeVenta", error, { saleId });
    return { error: mensajeDeErrorLealtad(error) };
  }
  const respuesta = data && typeof data === "object" && !Array.isArray(data) ? (data as { ok?: boolean; motivo?: string }) : {};
  revalidatePath("/seller/lealtad");
  after(() => drenarColaWallet());
  if (respuesta.ok === false) return { success: true, motivo: respuesta.motivo };
  return { success: true };
}
