"use server";

/**
 * Server actions de comunidades hiperlocales.
 *
 * SOLO se exportan funciones async: en un archivo "use server" cualquier otra
 * exportacion es un endpoint publico, y un export de tipo da 500.
 *
 * Todas las escrituras: sesion -> rate limit -> validador de @vicino/shared ->
 * RPC. Los limites reales viven en la base (cuotas 23514, permisos 42501); el
 * validador solo ahorra el viaje cuando el dato es obviamente malo. Los
 * errores de la base se traducen en UN sitio (lib/comunidades/errores.ts) y
 * las acciones devuelven `{ error }` o `{ data }`, que es la forma que
 * useOptimisticMutation ya entiende.
 */

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import {
  fundarComunidadSchema,
  editarDescripcionComunidadSchema,
  editarVisibilidadComunidadSchema,
  publicarEnComunidadSchema,
  comentarPublicacionSchema,
  solicitarUnionComunidadSchema,
  solicitudUnionIdSchema,
  moderadorComunidadSchema,
  editarCentroComunidadSchema,
} from "@vicino/shared";
import {
  traducirErrorComunidad,
  CODIGO_CUOTA,
  CODIGO_PERMISO,
  CODIGO_NO_EXISTE,
  CODIGO_ARGUMENTO,
  CODIGO_DUPLICADO,
} from "@/lib/comunidades/errores";
import {
  leerBooleano,
  leerNumero,
  leerTexto,
  leerEstadoCuota,
  type PostComunidad,
  type ComunidadCercana,
  type ComentarioComunidad,
  type SolicitudEnCola,
  type EstadoCuotaFundacion,
  type CursorComunidad,
} from "@/lib/comunidades/tipos";
import { z } from "zod";

const uuid = z.string().uuid();

const CODIGOS_ESPERADOS = new Set([
  CODIGO_CUOTA,
  CODIGO_PERMISO,
  CODIGO_NO_EXISTE,
  CODIGO_ARGUMENTO,
  CODIGO_DUPLICADO,
]);

/**
 * Sentry solo para lo que NO es un rechazo esperado: una cuota agotada o un
 * 42501 de la RPC son el sistema funcionando, no un incidente. Va ANTES del
 * return para no perder `details`, que es donde Postgres nombra la columna o
 * la policy (leccion del 42501 de modo_precio).
 */
function reportarSiInesperado(error: { code?: string; message?: string }, accion: string): void {
  if (error.code && CODIGOS_ESPERADOS.has(error.code)) return;
  Sentry.captureException(error, { tags: { action: accion, area: "comunidades" } });
}

async function sesionYFreno(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para continuar." };
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { ok: false, error: rate.error };
  return { ok: true, supabase, userId: user.id };
}

function clampLimite(limite: number, tope: number): number {
  if (!Number.isFinite(limite)) return tope;
  return Math.min(Math.max(1, Math.trunc(limite)), tope);
}

/** Cursor valido o null: un cursor malformado no toca la base. */
function cursorSeguro(cursor: CursorComunidad | null): CursorComunidad | null | "invalido" {
  if (!cursor) return null;
  if (Number.isNaN(Date.parse(cursor.time))) return "invalido";
  if (!uuid.safeParse(cursor.id).success) return "invalido";
  return cursor;
}

// ─── FUNDAR ────────────────────────────────────────────────────────────────

export async function fundarComunidad(input: {
  nombre: string;
  descripcion?: string | null;
  lat: number;
  lng: number;
  es_privada?: boolean;
}): Promise<{ error: string } | { data: { id: string; nombre: string; es_privada: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };

  const parsed = fundarComunidadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }
  const { nombre, descripcion, lat, lng, es_privada } = parsed.data;

  // fundar_comunidad no recibe la visibilidad: nace publica (decision 4) y
  // cerrarla es una segunda llamada, deliberada, que hace el mismo owner.
  const { data, error } = await s.supabase.rpc("fundar_comunidad", {
    p_nombre: nombre,
    p_lat: lat,
    p_lng: lng,
    p_descripcion: descripcion ?? undefined,
  });
  if (error) {
    reportarSiInesperado(error, "fundar_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo fundar la comunidad. Intenta de nuevo." };

  let privadaFinal = false;
  if (es_privada) {
    const { error: errVis } = await s.supabase.rpc("editar_visibilidad_comunidad", {
      p_community_id: id,
      p_privada: true,
    });
    // La comunidad YA existe: no se oculta el exito. Se avisa de que quedo
    // publica para que la cierre desde administrar.
    if (errVis) {
      reportarSiInesperado(errVis, "editar_visibilidad_comunidad@fundar");
    } else {
      privadaFinal = true;
    }
  }

  revalidatePath("/");
  return { data: { id, nombre: leerTexto(data, "nombre") ?? nombre, es_privada: privadaFinal } };
}

export async function estadoCuotaFundacion(): Promise<EstadoCuotaFundacion> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("estado_cuota_fundacion");
  if (error) {
    // Sin sesion o sin migracion: la UI no bloquea; la RPC de fundar decide.
    return leerEstadoCuota(null);
  }
  return leerEstadoCuota(data);
}

// ─── MEMBRESIA Y SOLICITUDES ───────────────────────────────────────────────

export async function alternarMembresia(
  communityId: string,
): Promise<{ error: string } | { data: { soy_miembro: boolean; miembros_count: number } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  if (!uuid.safeParse(communityId).success) return { error: "Comunidad inválida." };

  const { data, error } = await s.supabase.rpc("alternar_membresia_comunidad", {
    p_community_id: communityId,
  });
  if (error) {
    reportarSiInesperado(error, "alternar_membresia_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${communityId}`);
  revalidatePath("/");
  return {
    data: {
      soy_miembro: leerBooleano(data, "soy_miembro", false),
      miembros_count: leerNumero(data, "miembros_count", 0),
    },
  };
}

export async function solicitarUnion(input: {
  community_id: string;
  mensaje?: string | null;
}): Promise<{ error: string } | { data: { id: string; repetida: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = solicitarUnionComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };

  const { data, error } = await s.supabase.rpc("solicitar_union_comunidad", {
    p_community_id: parsed.data.community_id,
    p_mensaje: parsed.data.mensaje ?? undefined,
  });
  if (error) {
    reportarSiInesperado(error, "solicitar_union_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo enviar la solicitud. Intenta de nuevo." };
  revalidatePath(`/comunidades/${parsed.data.community_id}`);
  return { data: { id, repetida: leerBooleano(data, "repetida", false) } };
}

/**
 * Cancela MI solicitud pendiente a una comunidad. Recibe la comunidad y no
 * el id de la solicitud porque detalle_comunidad solo dice `solicitud_pendiente`
 * (booleano); el id se busca por REST, donde la policy "la mia" lo permite.
 */
export async function cancelarSolicitudPropia(
  communityId: string,
): Promise<{ error: string } | { data: { cancelada: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  if (!uuid.safeParse(communityId).success) return { error: "Comunidad inválida." };

  const { data: fila, error: errBusqueda } = await s.supabase
    .from("community_join_requests")
    .select("id")
    .eq("community_id", communityId)
    .eq("user_id", s.userId)
    .eq("status", "pendiente")
    .maybeSingle();
  if (errBusqueda) {
    reportarSiInesperado(errBusqueda, "cancelar_solicitud@buscar");
    return { error: traducirErrorComunidad(errBusqueda) };
  }
  // Ya no hay pendiente: idempotente, igual que la RPC.
  if (!fila) {
    revalidatePath(`/comunidades/${communityId}`);
    return { data: { cancelada: true } };
  }
  return cancelarSolicitud(fila.id, communityId);
}

export async function cancelarSolicitud(
  requestId: string,
  communityId?: string,
): Promise<{ error: string } | { data: { cancelada: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = solicitudUnionIdSchema.safeParse({ request_id: requestId });
  if (!parsed.success) return { error: "Solicitud inválida." };

  const { error } = await s.supabase.rpc("cancelar_solicitud_union", {
    p_request_id: parsed.data.request_id,
  });
  if (error) {
    reportarSiInesperado(error, "cancelar_solicitud_union");
    return { error: traducirErrorComunidad(error) };
  }
  if (communityId && uuid.safeParse(communityId).success) {
    revalidatePath(`/comunidades/${communityId}`);
  }
  revalidatePath("/");
  return { data: { cancelada: true } };
}

export async function resolverSolicitud(input: {
  request_id: string;
  aceptar: boolean;
  community_id: string;
}): Promise<{ error: string } | { data: { status: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = solicitudUnionIdSchema.safeParse({ request_id: input.request_id });
  if (!parsed.success) return { error: "Solicitud inválida." };
  if (typeof input.aceptar !== "boolean") return { error: "Datos inválidos." };

  const { data, error } = await s.supabase.rpc("resolver_solicitud_union", {
    p_request_id: parsed.data.request_id,
    p_aceptar: input.aceptar,
  });
  if (error) {
    reportarSiInesperado(error, "resolver_solicitud_union");
    return { error: traducirErrorComunidad(error) };
  }
  if (uuid.safeParse(input.community_id).success) {
    revalidatePath(`/comunidades/${input.community_id}`);
    revalidatePath(`/comunidades/${input.community_id}/administrar`);
  }
  return { data: { status: leerTexto(data, "status") ?? (input.aceptar ? "aceptada" : "rechazada") } };
}

export async function cargarSolicitudes(input: {
  community_id: string;
  cursor: CursorComunidad | null;
  limit?: number;
}): Promise<{ items: SolicitudEnCola[]; nextCursor: CursorComunidad | null; error?: string }> {
  const supabase = await createClient();
  if (!uuid.safeParse(input.community_id).success) {
    return { items: [], nextCursor: null, error: "Comunidad inválida." };
  }
  const cursor = cursorSeguro(input.cursor);
  if (cursor === "invalido") return { items: [], nextCursor: null, error: "Cursor inválido." };
  const limite = clampLimite(input.limit ?? 30, 30);

  const { data, error } = await supabase.rpc("solicitudes_de_comunidad", {
    p_community_id: input.community_id,
    cursor_time: cursor?.time ?? undefined,
    cursor_id: cursor?.id ?? undefined,
    result_limit: limite,
  });
  if (error) {
    reportarSiInesperado(error, "solicitudes_de_comunidad");
    return { items: [], nextCursor: null, error: traducirErrorComunidad(error) };
  }
  const items = data ?? [];
  const ultima = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === limite && ultima ? { time: ultima.created_at, id: ultima.id } : null,
  };
}

// ─── MODERADORES Y MIEMBROS ────────────────────────────────────────────────

export async function nombrarModerador(input: {
  community_id: string;
  user_id: string;
}): Promise<{ error: string } | { data: { role: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = moderadorComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos inválidos." };

  const { data, error } = await s.supabase.rpc("nombrar_moderador_comunidad", {
    p_community_id: parsed.data.community_id,
    p_user_id: parsed.data.user_id,
  });
  if (error) {
    reportarSiInesperado(error, "nombrar_moderador_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
  return { data: { role: leerTexto(data, "role") ?? "moderator" } };
}

export async function quitarModerador(input: {
  community_id: string;
  user_id: string;
}): Promise<{ error: string } | { data: { role: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = moderadorComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos inválidos." };

  const { data, error } = await s.supabase.rpc("quitar_moderador_comunidad", {
    p_community_id: parsed.data.community_id,
    p_user_id: parsed.data.user_id,
  });
  if (error) {
    reportarSiInesperado(error, "quitar_moderador_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
  return { data: { role: leerTexto(data, "role") ?? "member" } };
}

// ─── EDICION Y ARCHIVO ─────────────────────────────────────────────────────

export async function editarDescripcion(input: {
  community_id: string;
  descripcion: string | null;
}): Promise<{ error: string } | { data: { descripcion: string | null } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = editarDescripcionComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };

  const { data, error } = await s.supabase.rpc("editar_descripcion_comunidad", {
    p_community_id: parsed.data.community_id,
    // undefined omite el argumento y Postgres aplica su DEFAULT NULL, que es
    // exactamente "borrar la descripcion".
    p_descripcion: parsed.data.descripcion ?? undefined,
  });
  if (error) {
    reportarSiInesperado(error, "editar_descripcion_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${parsed.data.community_id}`);
  return { data: { descripcion: leerTexto(data, "descripcion") } };
}

export async function editarVisibilidad(input: {
  community_id: string;
  es_privada: boolean;
}): Promise<{ error: string } | { data: { es_privada: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = editarVisibilidadComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos inválidos." };

  const { data, error } = await s.supabase.rpc("editar_visibilidad_comunidad", {
    p_community_id: parsed.data.community_id,
    p_privada: parsed.data.es_privada,
  });
  if (error) {
    reportarSiInesperado(error, "editar_visibilidad_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${parsed.data.community_id}`);
  return { data: { es_privada: leerBooleano(data, "es_privada", parsed.data.es_privada) } };
}

export async function editarCentro(input: {
  community_id: string;
  lat: number;
  lng: number;
}): Promise<{ error: string } | { data: { lat: number; lng: number; movido: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = editarCentroComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Ubicación inválida" };

  const { data, error } = await s.supabase.rpc("editar_centro_comunidad", {
    p_community_id: parsed.data.community_id,
    p_lat: parsed.data.lat,
    p_lng: parsed.data.lng,
  });
  if (error) {
    reportarSiInesperado(error, "editar_centro_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
  return {
    data: {
      lat: leerNumero(data, "lat", parsed.data.lat),
      lng: leerNumero(data, "lng", parsed.data.lng),
      movido: leerBooleano(data, "movido", false),
    },
  };
}

export async function archivarComunidad(
  communityId: string,
): Promise<{ error: string } | { data: { archivada: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  if (!uuid.safeParse(communityId).success) return { error: "Comunidad inválida." };

  const { data, error } = await s.supabase.rpc("archivar_comunidad", {
    p_community_id: communityId,
  });
  if (error) {
    reportarSiInesperado(error, "archivar_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  revalidatePath(`/comunidades/${communityId}`);
  revalidatePath("/");
  return { data: { archivada: leerBooleano(data, "archivada", true) } };
}

// ─── PUBLICACIONES Y COMENTARIOS ───────────────────────────────────────────

export async function publicarEnComunidad(input: {
  community_id: string;
  texto: string;
}): Promise<{ error: string } | { data: { id: string; created_at: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = publicarEnComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };

  const { data, error } = await s.supabase.rpc("publicar_en_comunidad", {
    p_community_id: parsed.data.community_id,
    p_texto: parsed.data.texto,
  });
  if (error) {
    reportarSiInesperado(error, "publicar_en_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo publicar. Intenta de nuevo." };
  return { data: { id, created_at: leerTexto(data, "created_at") ?? new Date().toISOString() } };
}

export async function comentarPublicacion(input: {
  community_id: string;
  parent_post_id: string;
  texto: string;
}): Promise<{ error: string } | { data: { id: string; created_at: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = comentarPublicacionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };

  const { data, error } = await s.supabase.rpc("publicar_en_comunidad", {
    p_community_id: parsed.data.community_id,
    p_texto: parsed.data.texto,
    p_parent_post_id: parsed.data.parent_post_id,
  });
  if (error) {
    reportarSiInesperado(error, "publicar_en_comunidad@comentar");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo comentar. Intenta de nuevo." };
  return { data: { id, created_at: leerTexto(data, "created_at") ?? new Date().toISOString() } };
}

/** Borra publicacion o comentario (misma RPC; la base decide quien puede). */
export async function eliminarPublicacion(
  postId: string,
): Promise<{ error: string } | { data: { borrado: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  if (!uuid.safeParse(postId).success) return { error: "Publicación inválida." };

  const { data, error } = await s.supabase.rpc("eliminar_publicacion_comunidad", {
    p_post_id: postId,
  });
  if (error) {
    reportarSiInesperado(error, "eliminar_publicacion_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  return { data: { borrado: leerBooleano(data, "borrado", false) } };
}

export async function alternarLike(
  postId: string,
): Promise<{ error: string } | { data: { le_di_like: boolean; likes_count: number } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  if (!uuid.safeParse(postId).success) return { error: "Publicación inválida." };

  const { data, error } = await s.supabase.rpc("alternar_like_publicacion", { p_post_id: postId });
  if (error) {
    reportarSiInesperado(error, "alternar_like_publicacion");
    return { error: traducirErrorComunidad(error) };
  }
  return {
    data: {
      le_di_like: leerBooleano(data, "le_di_like", false),
      likes_count: leerNumero(data, "likes_count", 0),
    },
  };
}

// ─── LECTURAS PAGINADAS ────────────────────────────────────────────────────

export async function cargarMuro(input: {
  community_id: string;
  cursor: CursorComunidad | null;
  limit?: number;
}): Promise<{ items: PostComunidad[]; nextCursor: CursorComunidad | null; error?: string }> {
  const supabase = await createClient();
  if (!uuid.safeParse(input.community_id).success) {
    return { items: [], nextCursor: null, error: "Comunidad inválida." };
  }
  const cursor = cursorSeguro(input.cursor);
  if (cursor === "invalido") return { items: [], nextCursor: null, error: "Cursor inválido." };
  const limite = clampLimite(input.limit ?? 30, 50);

  const { data, error } = await supabase.rpc("feed_muro_comunidad", {
    p_community_id: input.community_id,
    cursor_time: cursor?.time ?? undefined,
    cursor_id: cursor?.id ?? undefined,
    result_limit: limite,
  });
  if (error) {
    reportarSiInesperado(error, "feed_muro_comunidad");
    return { items: [], nextCursor: null, error: traducirErrorComunidad(error) };
  }
  const items = data ?? [];
  const ultima = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === limite && ultima ? { time: ultima.created_at, id: ultima.id } : null,
  };
}

export async function cargarMuroUnificado(input: {
  cursor: CursorComunidad | null;
  limit?: number;
}): Promise<{ items: PostComunidad[]; nextCursor: CursorComunidad | null; error?: string }> {
  const supabase = await createClient();
  const cursor = cursorSeguro(input.cursor);
  if (cursor === "invalido") return { items: [], nextCursor: null, error: "Cursor inválido." };
  const limite = clampLimite(input.limit ?? 30, 50);

  const { data, error } = await supabase.rpc("feed_comunidades_explorar", {
    cursor_time: cursor?.time ?? undefined,
    cursor_id: cursor?.id ?? undefined,
    result_limit: limite,
  });
  if (error) {
    reportarSiInesperado(error, "feed_comunidades_explorar");
    return { items: [], nextCursor: null, error: traducirErrorComunidad(error) };
  }
  const items = data ?? [];
  const ultima = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === limite && ultima ? { time: ultima.created_at, id: ultima.id } : null,
  };
}

/**
 * Hilo ASCENDENTE (del mas viejo al mas nuevo) con cursor `>`: el unico
 * sitio del diseno donde se invierte el sentido. El cursor es el ULTIMO
 * comentario de la pagina.
 */
export async function cargarComentarios(input: {
  post_id: string;
  cursor: CursorComunidad | null;
  limit?: number;
}): Promise<{ items: ComentarioComunidad[]; nextCursor: CursorComunidad | null; error?: string }> {
  const supabase = await createClient();
  if (!uuid.safeParse(input.post_id).success) {
    return { items: [], nextCursor: null, error: "Publicación inválida." };
  }
  const cursor = cursorSeguro(input.cursor);
  if (cursor === "invalido") return { items: [], nextCursor: null, error: "Cursor inválido." };
  const limite = clampLimite(input.limit ?? 30, 50);

  const { data, error } = await supabase.rpc("comentarios_de_publicacion", {
    p_post_id: input.post_id,
    cursor_time: cursor?.time ?? undefined,
    cursor_id: cursor?.id ?? undefined,
    result_limit: limite,
  });
  if (error) {
    reportarSiInesperado(error, "comentarios_de_publicacion");
    return { items: [], nextCursor: null, error: traducirErrorComunidad(error) };
  }
  const items = data ?? [];
  const ultima = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === limite && ultima ? { time: ultima.created_at, id: ultima.id } : null,
  };
}

export async function cargarDescubrir(input: {
  lat: number;
  lng: number;
}): Promise<{ items: ComunidadCercana[]; error?: string }> {
  const { lat, lng } = input;
  const supabase = await createClient();
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return { items: [], error: "Ubicación inválida." };
  }
  const { data, error } = await supabase.rpc("descubrir_comunidades", {
    p_lat: lat,
    p_lng: lng,
    result_limit: 30,
  });
  if (error) {
    reportarSiInesperado(error, "descubrir_comunidades");
    return { items: [], error: traducirErrorComunidad(error) };
  }
  return { items: data ?? [] };
}
