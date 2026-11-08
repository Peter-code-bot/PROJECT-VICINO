"use server";

/**
 * Admin: conectar el numero de WhatsApp (phone_number_id de Meta) a un negocio,
 * pausarlo/reactivarlo y desconectarlo. En el piloto el numero es el de prueba
 * de Meta y lo conecta el equipo; cada RPC vuelve a comprobar el rol admin
 * dentro de la transaccion, asi que aqui solo se valida y se traduce el error.
 */
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export interface EstadoConexion {
  ok: boolean;
  mensaje: string | null;
}

const conectarSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .min(1, "Escribe el usuario del negocio (su @ en VICINO).")
    .max(64)
    .transform((v) => v.replace(/^@/, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9_]{3,30}$/, "El usuario solo lleva letras, números y guion bajo (3 a 30).")),
  phoneNumberId: z.string().trim().regex(/^[0-9]{5,32}$/, "El Phone number ID son solo dígitos (API Setup de Meta)."),
  wabaId: z.string().trim().regex(/^[0-9]{5,32}$/, "El WhatsApp Business Account ID son solo dígitos."),
  numeroMostrado: z
    .string()
    .trim()
    .max(24, "El número mostrado es demasiado largo.")
    .transform((v) => (v === "" ? null : v)),
});

/** Codigos cuyos mensajes escribimos nosotros en SQL (RAISE con texto para la persona). */
const CODIGOS_CON_MENSAJE_PROPIO = new Set(["22023", "23505"]);

function traducirError(error: { code?: string; message?: string }, accion: string): string {
  if (error.code === "42501") return "Solo un administrador puede hacer esto.";
  // Un 23505 nativo de Postgres ("duplicate key value violates...") no es
  // nuestro: solo se muestran los que escribimos en los RPC (empiezan por "Ese").
  if (error.code && CODIGOS_CON_MENSAJE_PROPIO.has(error.code) && error.message && !/duplicate key|violates/i.test(error.message)) {
    return error.message;
  }
  Sentry.captureException(error, { tags: { action: accion } });
  return "No se pudo completar. Intenta de nuevo.";
}

async function admin(): Promise<{ supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]; userId: string } | null> {
  try {
    const { supabase, user } = await requireAdmin();
    return { supabase, userId: user.id };
  } catch {
    return null;
  }
}

export async function conectarCanalWhatsApp(_anterior: EstadoConexion, formData: FormData): Promise<EstadoConexion> {
  const sesion = await admin();
  if (!sesion) return { ok: false, mensaje: "Solo un administrador puede hacer esto." };

  const freno = await enforce(writeRateLimit, `write:${sesion.userId}`);
  if (!freno.ok) return { ok: false, mensaje: freno.error };

  const parsed = conectarSchema.safeParse({
    username: formData.get("username") ?? "",
    phoneNumberId: formData.get("phone_number_id") ?? "",
    wabaId: formData.get("waba_id") ?? "",
    numeroMostrado: formData.get("numero_mostrado") ?? "",
  });
  if (!parsed.success) return { ok: false, mensaje: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  // El username se guarda con la caja que escribio la persona y es unico por
  // lower(username): se busca sin distinguir mayusculas. El valor ya paso el
  // regex (sin % ni _ sueltos... el _ es comodin de ilike, se escapa).
  const patron = parsed.data.username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: perfil, error: errorPerfil } = await sesion.supabase
    .from("profiles")
    .select("id, es_vendedor, nombre_negocio, username")
    .ilike("username", patron)
    .maybeSingle();
  if (errorPerfil) return { ok: false, mensaje: traducirError(errorPerfil, "conectarCanalWhatsApp") };
  if (!perfil) return { ok: false, mensaje: `No hay ningún perfil con el usuario @${parsed.data.username}.` };
  if (!perfil.es_vendedor) return { ok: false, mensaje: "Ese perfil no tiene el modo vendedor activo." };

  const { error } = await sesion.supabase.rpc("conectar_canal_whatsapp", {
    p_negocio_id: perfil.id,
    p_phone_number_id: parsed.data.phoneNumberId,
    p_waba_id: parsed.data.wabaId,
    p_numero_mostrado: parsed.data.numeroMostrado ?? undefined,
  });
  if (error) return { ok: false, mensaje: traducirError(error, "conectarCanalWhatsApp") };

  revalidatePath("/admin/whatsapp");
  return { ok: true, mensaje: `Número conectado a ${perfil.nombre_negocio ?? `@${perfil.username ?? parsed.data.username}`}.` };
}

export async function cambiarEstadoCanalWhatsApp(canalId: string, activo: boolean): Promise<EstadoConexion> {
  const sesion = await admin();
  if (!sesion) return { ok: false, mensaje: "Solo un administrador puede hacer esto." };

  const freno = await enforce(writeRateLimit, `write:${sesion.userId}`);
  if (!freno.ok) return { ok: false, mensaje: freno.error };

  const id = z.uuid().safeParse(canalId);
  if (!id.success || typeof activo !== "boolean") return { ok: false, mensaje: "Datos inválidos." };

  const { data, error } = await sesion.supabase.rpc("cambiar_estado_canal_whatsapp", {
    p_canal_id: id.data,
    p_activo: activo,
  });
  if (error) return { ok: false, mensaje: traducirError(error, "cambiarEstadoCanalWhatsApp") };
  if (!data) return { ok: false, mensaje: "No se encontró ese número." };

  revalidatePath("/admin/whatsapp");
  return {
    ok: true,
    mensaje: activo
      ? "Número reactivado: el negocio ya puede responder."
      : "Número pausado: el negocio no puede responder; lo que le llegue se sigue guardando.",
  };
}

export async function eliminarCanalWhatsApp(canalId: string): Promise<EstadoConexion> {
  const sesion = await admin();
  if (!sesion) return { ok: false, mensaje: "Solo un administrador puede hacer esto." };

  const freno = await enforce(writeRateLimit, `write:${sesion.userId}`);
  if (!freno.ok) return { ok: false, mensaje: freno.error };

  const id = z.uuid().safeParse(canalId);
  if (!id.success) return { ok: false, mensaje: "Datos inválidos." };

  const { data, error } = await sesion.supabase.rpc("eliminar_canal_whatsapp", { p_canal_id: id.data });
  if (error) return { ok: false, mensaje: traducirError(error, "eliminarCanalWhatsApp") };
  if (!data) return { ok: false, mensaje: "No se encontró ese número." };

  revalidatePath("/admin/whatsapp");
  return { ok: true, mensaje: "Número desconectado; sus conversaciones y mensajes se borraron." };
}
