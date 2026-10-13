"use server";

import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { usernameSchema } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { PASOS_ONBOARDING, type PasoOnboarding } from "@/lib/onboarding/steps";
import { cookies } from "next/headers";
import { COOKIE_DESTINO_ONBOARDING } from "@/lib/auth/acceso-invitado";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";

export type { PasoOnboarding } from "@/lib/onboarding/steps";
export type CaminoOnboarding = "explorar" | "vender";

export interface GuardarPasoInput {
  camino?: CaminoOnboarding;
  /** El siguiente paso pendiente, persistido junto con el dato actual. */
  paso?: PasoOnboarding;
  username?: string;
  nombre?: string;
  bio?: string;
  foto?: string;
  intereses?: string[];
  categoria_negocio?: string;
  seller_type?: "casual" | "business";
  nombre_negocio?: string;
  descripcion_negocio?: string;
  metodos_pago_aceptados?: string;
}

const guardarPasoSchema = z.object({
  camino: z.enum(["explorar", "vender"]).optional(),
  paso: z.string().refine(
    (paso) => paso === "perfil" || paso === "activar" || PASOS_ONBOARDING.some((actual) => actual === paso),
    "Paso de onboarding inválido.",
  ).optional(),
  username: usernameSchema.optional(),
  nombre: z.string().trim().min(2, "Escribe al menos 2 caracteres.").max(60, "Máximo 60 caracteres.").optional(),
  bio: z.string().trim().min(1, "Escribe una descripción o elige Omitir.").max(160, "Máximo 160 caracteres.").optional(),
  foto: z.string().url("Esa foto no es válida.").regex(/^https?:\/\/\S+$/, "Esa foto no es válida.").max(500).optional(),
  intereses: z.array(z.string().min(1).max(80)).min(1, "Elige entre 1 y 5 intereses.").max(5, "Elige entre 1 y 5 intereses.").optional(),
  categoria_negocio: z.string().min(1, "Elige una categoría.").max(80).optional(),
  seller_type: z.enum(["casual", "business"]).optional(),
  nombre_negocio: z.string().trim().min(2, "Escribe al menos 2 caracteres.").max(100, "Máximo 100 caracteres.").optional(),
  descripcion_negocio: z.string().trim().min(1, "Escribe una descripción o elige Omitir.").max(1000, "Máximo 1000 caracteres.").optional(),
  metodos_pago_aceptados: z.string().trim().min(1, "Elige cómo aceptas pagos o elige Omitir.").max(500).optional(),
}).strict();

// SQL codes also describe grants, constraints and other internal failures.
// Only fixed, reviewed validation messages can cross the action boundary.
const publicOnboardingErrors: Record<string, string> = Object.fromEntries(([
  ["42501", "Confirma los Términos y el Aviso de Privacidad para continuar."],
  ["42501", "Confirma la visibilidad de tu perfil antes de comenzar a vender."],
  ["22023", "El nombre de usuario debe tener entre 3 y 30 caracteres y usar solo letras, numeros y guion bajo."],
  ["22023", "Ese nombre de usuario esta reservado."],
  ["23505", "Ese nombre de usuario ya esta en uso."],
  ["22023", "El nombre debe tener entre 2 y 60 caracteres."],
  ["22023", "La descripcion debe tener entre 1 y 160 caracteres."],
  ["22023", "Esa foto no es valida."],
  ["22023", "El nombre del negocio debe tener entre 2 y 100 caracteres."],
  ["22023", "La descripcion del negocio debe tener entre 1 y 1000 caracteres."],
  ["22023", "Los metodos de pago no son validos."],
  ["22023", "Esa categoria no existe."],
  ["22023", "Elige entre 1 y 5 intereses validos."],
  ["22023", "Guarda un dato a la vez."],
  ["22023", "El dato no corresponde a esta pantalla."],
  ["22023", "El onboarding ya terminó."],
  ["22023", "Elige cómo quieres entrar a VICINO."],
  ["22023", "Elige una categoría antes de comenzar a vender."],
  ["22023", "Confirma el nombre de tu negocio antes de comenzar a vender."],
] as const).map(([code, message]) => [`${code}:${message}`, message]));
const profileNotReady = "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo; si persiste, contáctanos.";
function publicOnboardingError(error: { code?: string; message: string }): string | undefined {
  if (error.code === "P0002") return profileNotReady;
  return publicOnboardingErrors[`${error.code}:${error.message}`];
}

/**
 * Guarda UN paso del onboarding sin tocar lo que guardaron los anteriores.
 *
 * Va por RPC y no por un update normal porque `authenticated` solo tiene
 * UPDATE sobre (foto, fcm_token) en profiles — los privilegios de esa tabla se
 * dan columna por columna. Nombre, bio e intereses son inalcanzables desde el
 * cliente por cualquier otra via.
 *
 * El COALESCE vive dentro del RPC v2: omitir un campo
 * significa «no lo toques», nunca «borralo». Es lo que permite que el paso 3
 * llame sin mandar lo del paso 2.
 */
export async function guardarPasoOnboarding(input: GuardarPasoInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // La misma cuota que usa el resto de escrituras del repo (chat, publicar,
  // favoritos). Esto es una server action, o sea un endpoint HTTP alcanzable
  // sin pasar por la pantalla, y escribe en profiles a traves de un
  // SECURITY DEFINER. Quedarse fuera del patron no tenia ninguna razon: era el
  // unico endpoint de escritura del onboarding sin freno.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // La entrada es un endpoint: TypeScript y maxLength no validan una petición.
  const parsed = guardarPasoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa la información de este paso." };
  }
  const datos = parsed.data;

  // El username, los borradores de vendedor y el avance se guardan en una
  // transacción. Este RPC no activa es_vendedor ni cambia el ID interno.
  const { data, error } = await supabase.rpc("guardar_paso_onboarding_v2", {
    p_camino: datos.camino,
    p_paso: datos.paso,
    p_username: datos.username,
    p_nombre: datos.nombre,
    p_bio: datos.bio,
    p_foto: datos.foto,
    p_intereses: datos.intereses,
    p_categoria_negocio: datos.categoria_negocio,
    p_seller_type: datos.seller_type,
    p_nombre_negocio: datos.nombre_negocio,
    p_descripcion_negocio: datos.descripcion_negocio,
    p_metodos_pago_aceptados: datos.metodos_pago_aceptados,
  });

  if (error) {
    const publicMessage = publicOnboardingError(error);
    if (publicMessage) return { error: publicMessage };
    // El detalle tecnico se queda en el servidor. Postgres nombra la columna o
    // la policy que rechazo en `details`, y perderlo obliga a diagnosticar a
    // ciegas — ya paso con el 42501 de modo_precio.
    Sentry.captureException(error, {
      tags: { action: "guardar_paso_onboarding_v2" },
      contexts: { supabase: { code: error.code, details: error.details } },
    });

    return { error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
  }

  await revalidatePath("/completar-perfil", "layout");
  await revalidatePath("/perfil");
  return { success: true, data };
}

const checkpointFieldsSchema = guardarPasoSchema.omit({ camino: true, paso: true }).refine(
  fields => Object.keys(fields).length <= 1, "Guarda un dato a la vez.",
);
const operationSchema = z.object({
  operationId: z.string().uuid(), expectedUserId: z.string().uuid(), expectedRevision: z.number().int().min(0).max(2147483646),
});
const checkpointSchema = operationSchema.extend({
  fromStep: z.string().refine(step => PASOS_ONBOARDING.some(actual => actual === step)),
  nextStep: z.string().refine(step => PASOS_ONBOARDING.some(actual => actual === step)),
  camino: z.enum(["explorar", "vender"]), fields: checkpointFieldsSchema,
}).strict();
const finishSchema = operationSchema.extend({ decision: z.enum(["explorar", "activar"]) }).strict();
const canonicalSchema = z.object({
  status: z.enum(["saved", "conflict"]), revision: z.number().int().nonnegative(),
  paso: z.string().nullable(), camino: z.string().nullable(),
  snapshot: z.object({
    id: z.string().uuid(), username: z.string(), nombre: z.string(), bio: z.string().nullable(), foto: z.string().nullable(),
    intereses: z.array(z.string()).nullable(), onboarding_camino: z.string().nullable(), onboarding_paso: z.string().nullable(),
    onboarding_revision: z.number().int().nonnegative(), has_seen_onboarding: z.boolean(), es_vendedor: z.boolean().nullable(),
    seller_type: z.string().nullable(), categoria_negocio: z.string().nullable(), nombre_negocio: z.string().nullable(),
    descripcion_negocio: z.string().nullable(), metodos_pago_aceptados: z.string().nullable(),
  }),
});
export type CheckpointData = z.infer<typeof canonicalSchema>;
export type CheckpointResult =
  | { success: true; data: CheckpointData; error?: undefined; conflict?: false; uncertain?: false; destino?: string }
  | { success?: false; error: string; conflict: true; data: CheckpointData; uncertain?: false; destino?: undefined }
  | { success?: false; error: string; conflict?: false; data?: undefined; uncertain?: boolean; destino?: undefined };
export interface GuardarCheckpointInput {
  operationId: string; expectedUserId: string; expectedRevision: number; fromStep: string; nextStep: string;
  camino: CaminoOnboarding; fields: Omit<GuardarPasoInput, "camino" | "paso">;
}
export interface FinalizarOnboardingInput {
  operationId: string; expectedUserId: string; expectedRevision: number; decision: "explorar" | "activar";
}

function checkpointError(error: { code?: string; message: string }, action: string): CheckpointResult {
  const publicMessage = publicOnboardingError(error);
  if (publicMessage) return { error: publicMessage };
  Sentry.captureException(error, { tags: { action } });
  if (["22023", "23505", "42501", "P0002"].includes(error.code ?? ""))
    return { error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
  return { error: "No pudimos confirmar que se guardó. Intenta de nuevo con la misma operación.", uncertain: true as const };
}

function canonicalResult(data: unknown, expectedUserId: string): CheckpointResult {
  const parsed = canonicalSchema.safeParse(data);
  if (!parsed.success || parsed.data.snapshot.id !== expectedUserId || parsed.data.revision !== parsed.data.snapshot.onboarding_revision
    || parsed.data.paso !== parsed.data.snapshot.onboarding_paso || parsed.data.camino !== parsed.data.snapshot.onboarding_camino) {
    return { error: "No pudimos comprobar el estado guardado. Intenta de nuevo.", uncertain: true as const };
  }
  if (parsed.data.status === "conflict") return { error: "Tus datos cambiaron en otra sesión. Revisa la información guardada.", conflict: true as const, data: parsed.data };
  return { success: true as const, data: parsed.data };
}

export async function guardarCheckpointOnboarding(input: GuardarCheckpointInput): Promise<CheckpointResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const parsed = checkpointSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa la operación pendiente." };
  if (parsed.data.expectedUserId !== user.id) return { error: "La cuenta cambió. No guardaremos datos de otra cuenta." };
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };
  const item = parsed.data;
  const { data, error } = await supabase.rpc("guardar_checkpoint_onboarding_v3", {
    p_operation_id: item.operationId, p_expected_revision: item.expectedRevision, p_from_step: item.fromStep, p_next_step: item.nextStep,
    p_camino: item.camino, p_fields: item.fields,
  });
  if (error) return checkpointError(error, "guardar_checkpoint_onboarding_v3");
  return canonicalResult(data, user.id);
}

/** A choice is an empty-field v3 checkpoint, with the same receipt on every replay. */
export async function elegirCaminoOnboarding(input: GuardarCheckpointInput): Promise<CheckpointResult> {
  const parsed = checkpointSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data.fields).length !== 0
    || parsed.data.nextStep !== (parsed.data.camino === "vender" ? "categoria" : "usuario"))
    return { error: "Revisa cómo quieres empezar antes de continuar." };
  const result = await guardarCheckpointOnboarding(parsed.data);
  // A prefetched layout can otherwise contain the profile from before the choice.
  if (result.success) await revalidatePath("/completar-perfil", "layout");
  return result;
}

export async function finalizarOnboarding(input: FinalizarOnboardingInput): Promise<CheckpointResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "Revisa cómo quieres entrar a VICINO." };
  if (parsed.data.expectedUserId !== user.id) return { error: "La cuenta cambió. No guardaremos datos de otra cuenta." };
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };
  const { data, error } = await supabase.rpc("finalizar_onboarding_v3", {
    p_operation_id: parsed.data.operationId, p_expected_revision: parsed.data.expectedRevision, p_decision: parsed.data.decision,
  });
  if (error) return checkpointError(error, "finalizar_onboarding_v3");
  const result = canonicalResult(data, user.id);
  if (!result.success) return result;
  const store = await cookies();
  const destino = destinoAutenticadoSeguro(store.get(COOKIE_DESTINO_ONBOARDING)?.value);
  // Retain the existing 1800s return cookie through the action's RSC refresh.
  // The completed loader uses it too, so its redirect cannot eclipse this ACK.
  await revalidatePath("/");
  return { ...result, destino };
}
