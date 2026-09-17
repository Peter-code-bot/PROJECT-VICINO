"use server";

import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth/require-admin";
import { approveVerificationSchema, rejectVerificationSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

/**
 * Lo que devuelve PostgREST cuando falla una RPC, sin `any`.
 *
 * `code` es lo unico en lo que se puede decidir: el `message` es texto del
 * motor, cambia de version en version y no se le ensena a nadie.
 */
type ErrorDeRpc = { message?: string; code?: string; details?: string };

/**
 * El mensaje que ve la persona, NO el de Postgres.
 *
 * El rechazo devolvia `error.message` tal cual, y debajo del boton de
 * confirmar aparecia «permission denied for table seller_verification»: un
 * texto que no dice que hacer, nombra una tabla interna y apunta a RLS cuando
 * el fallo real era un GRANT de columna ausente. Es el mismo error de
 * diagnostico que ya se pago con `modo_precio` en vender/actions.ts.
 */
function mensajeDeVeredicto(error: ErrorDeRpc, verbo: "aprobar" | "rechazar"): string {
  switch (error.code) {
    case "42501":
      return "Tu sesión no tiene permiso de revisión. Vuelve a entrar con tu cuenta de administrador.";
    case "P0002":
      return "Esa verificación ya no está en la cola. Recarga la página.";
    case "22023":
      return "Los datos de esa verificación no cuadran. Recarga la página e inténtalo otra vez.";
    case "23514":
      // El trigger guard_verification_approval (20260826230000) exige las tres
      // imagenes para aprobar. Sin este caso, el admin leia un 23514 crudo.
      return "A esa solicitud le faltan documentos, así que no se puede aprobar. Pide que se suban los tres.";
    case "PGRST202":
      return `No se pudo ${verbo} la verificación: falta una actualización del servidor. Ya lo estamos revisando.`;
    default:
      return `No se pudo ${verbo} la verificación. Inténtalo de nuevo en un momento.`;
  }
}

export async function approveVerification(verificationId: string, userId: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = approveVerificationSchema.safeParse({
    verification_id: verificationId,
    user_id: userId,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // MP#07 Fase 4 + MP#08 #6: atomic approve verification via RPC.
  // Replaces the 3 separate writes (seller_verification UPDATE +
  // profiles UPDATE + trust_level_verification upsert) with a single
  // SECURITY DEFINER function that runs them in one implicit
  // transaction. Migration: 20260528000003_rpc_approve_verification_atomic.
  const { error: rpcError } = await supabase.rpc(
    "approve_verification_atomic",
    {
      p_verification_id: parsed.data.verification_id,
      p_user_id: parsed.data.user_id,
    },
  );

  if (rpcError) {
    Sentry.captureException(rpcError, {
      tags: { action: "approveVerification", step: "rpc_call" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (rpcError as ErrorDeRpc).code,
          details: (rpcError as ErrorDeRpc).details,
        },
      },
    });
    // El `message` del motor se queda en Sentry, que es donde sirve. Al admin
    // se le dice que paso y que hacer.
    return { error: mensajeDeVeredicto(rpcError as ErrorDeRpc, "aprobar") };
  }

  // Notificacion fuera del RPC atomico: no es estado canonico mutable, un
  // fallo aqui no causa divergencia. Va por notify_user_as_staff (SECURITY
  // DEFINER, valida admin o moderator con has_role) porque notifications NO
  // tiene policy de INSERT: el insert directo moria con 42501 y el vendedor
  // nunca se enteraba. Migracion: 20260826080000_lock_down_create_notification.
  // supabase-js no lanza en error de PostgREST — el try/catch anterior era
  // codigo muerto, hay que leer `error`.
  const { error: notifError } = await supabase.rpc("notify_user_as_staff", {
    p_user_id: parsed.data.user_id,
    p_tipo: "trust_upgrade",
    p_titulo: "¡Identidad verificada!",
    p_mensaje:
      "Tu identidad ha sido verificada. Ganaste 30 puntos de confianza.",
    p_data: { verification_id: parsed.data.verification_id },
  });

  if (notifError) {
    Sentry.captureException(notifError, {
      tags: { action: "approveVerification", step: "post_rpc_notification" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (notifError as { code?: string }).code,
          details: (notifError as { details?: string }).details,
        },
      },
    });
    // NO abortar — el approval ya fue atomico en el RPC.
  }

  // audit_log fuera del RPC atomico: rastro legal post-hoc, la prueba canonica
  // de la aprobacion es seller_verification.reviewed_at que escribe el RPC.
  // La policy admins_insert_audit si permite esta escritura, pero supabase-js
  // no lanza en error de PostgREST: sin leer `error` un fallo se perdia entero.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "approve_verification",
    target_type: "verification",
    target_id: parsed.data.verification_id,
    metadata: { userId: parsed.data.user_id },
  });

  if (auditError) {
    Sentry.captureException(auditError, {
      tags: { action: "approveVerification", step: "post_rpc_audit_log" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (auditError as { code?: string }).code,
          details: (auditError as { details?: string }).details,
        },
      },
    });
    // NO abortar — audit_log es trazabilidad post-hoc, no estado canonico.
  }

  return { success: true };
}

export async function rejectVerification(verificationId: string, note: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = rejectVerificationSchema.safeParse({
    verification_id: verificationId,
    note: note ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Se lee el dueno ANTES del rechazo porque despues hace falta para avisarle.
  const { data: ver } = await supabase
    .from("seller_verification")
    .select("user_id")
    .eq("id", parsed.data.verification_id)
    .single();

  // La nota se normaliza aqui y no solo en la base: asi el aviso que recibe el
  // vendedor y lo que queda guardado dicen exactamente lo mismo.
  const nota = parsed.data.note.trim() || null;

  // El UPDATE directo que habia aqui NO PODIA FUNCIONAR, y no era un caso
  // borde: fallaba el 100% de los rechazos con
  // «permission denied for table seller_verification».
  //
  // 20260826301000 revoco el UPDATE de tabla a `authenticated` y devolvio el
  // privilegio solo a siete columnas. reviewed_at y reviewer_note no estan
  // entre ellas, a proposito, porque son el veredicto. Y un admin es el rol
  // `authenticated` ante Postgres: lo que le da poder es la policy «Admin can
  // manage verifications», que es RLS, y un GRANT ausente se comprueba antes
  // que cualquier policy.
  //
  // Por eso aprobar si funcionaba: pasa por approve_verification_atomic, que
  // es SECURITY DEFINER. Rechazar ahora tiene su espejo.
  // `p_note` viaja como cadena y no como null porque el codegen de Supabase
  // NO declara nulables los argumentos de una RPC: el tipo generado dice
  // `p_note: string`. No cambia el dato guardado — la funcion hace
  // nullif(btrim(coalesce(p_note,'')),''), asi que la cadena vacia queda NULL
  // en reviewer_note igual que un null.
  const { error: rpcError } = await supabase.rpc("reject_verification_atomic", {
    p_verification_id: parsed.data.verification_id,
    p_note: nota ?? "",
  });

  if (rpcError) {
    Sentry.captureException(rpcError, {
      tags: { action: "rejectVerification", step: "rpc_call" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: { code: rpcError.code, details: rpcError.details },
      },
    });
    return { error: mensajeDeVeredicto(rpcError, "rechazar") };
  }

  // La policy admins_insert_audit permite esta escritura, pero supabase-js no
  // lanza en error de PostgREST: sin leer `error` un fallo se pierde entero.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "reject_verification",
    target_type: "verification",
    target_id: parsed.data.verification_id,
    metadata: { note: nota },
  });

  if (auditError) {
    Sentry.captureException(auditError, {
      tags: { action: "rejectVerification", step: "audit_log" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (auditError as { code?: string }).code,
          details: (auditError as { details?: string }).details,
        },
      },
    });
    // NO abortar — audit_log es trazabilidad post-hoc, no estado canonico.
  }

  // Avisar al vendedor. Via notify_user_as_staff (SECURITY DEFINER, valida
  // admin o moderator) porque notifications NO tiene policy de INSERT: el
  // insert directo moria con 42501 y el rechazo nunca llegaba a quien lo
  // recibio. Migracion: 20260826080000_lock_down_create_notification.
  if (!ver?.user_id) {
    Sentry.captureException(
      new Error("rejectVerification: verificacion sin user_id, no se notifico"),
      {
        tags: { action: "rejectVerification", step: "notification_skipped" },
        contexts: { verification: { id: parsed.data.verification_id } },
      },
    );
  } else {
    const { error: notifError } = await supabase.rpc("notify_user_as_staff", {
      p_user_id: ver.user_id,
      p_tipo: "trust_upgrade",
      p_titulo: "Verificación rechazada",
      p_mensaje: nota
        ? `Tu verificación fue rechazada: ${nota}. Puedes intentar de nuevo.`
        : "Tu verificación fue rechazada. Puedes intentar de nuevo.",
      p_data: { verification_id: parsed.data.verification_id },
    });

    if (notifError) {
      Sentry.captureException(notifError, {
        tags: { action: "rejectVerification", step: "notification" },
        contexts: {
          verification: { id: parsed.data.verification_id },
          supabase: {
            code: (notifError as { code?: string }).code,
            details: (notifError as { details?: string }).details,
          },
        },
      });
      // NO abortar — el rechazo ya quedo escrito en seller_verification.
    }
  }

  return { success: true };
}
