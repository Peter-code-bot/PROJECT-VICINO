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

import { headers } from "next/headers";
import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, getClientIp, readHeavyRateLimit, writeRateLimit } from "@/lib/rate-limit";
import type { Database } from "@/types/database.types";
import {
  COMMUNITY_POST_MAX,
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
  esRutaDeAutor,
  MAX_IMAGENES_POR_PUBLICACION,
} from "@/lib/comunidades/media";
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

  await revalidatePath("/");
  return { data: { id, nombre: leerTexto(data, "nombre") ?? nombre, es_privada: privadaFinal } };
}

/**
 * Freno de las LECTURAS de comunidades.
 *
 * `sesionYFreno()` cubre las 16 escrituras del modulo; estas seis lecturas no
 * pasaban por ningun sitio. Y no son lecturas baratas: `cargarMuroUnificado`
 * es el fan-out que la propia migracion acota en 600
 * (membresias_vivas x pagina_muro), y `cargarDescubrir` es una superficie de
 * descubrimiento geografico. Son exactamente el perfil para el que existe
 * readHeavyRateLimit.
 *
 * DECISION DEL IDENTIFICADOR, que hay que tomarla y no heredarla: se usa
 * `read:` — el MISMO que lib/geo/actions.ts — y no uno nuevo tipo `com:`. En
 * Upstash la clave es prefijo + identificador, asi que un identificador propio
 * habria sido una cubeta MAS: el techo agregado de lectura pesada por IP
 * habria pasado de 120/min a 180/min sin que nadie lo decidiera. Compartir
 * cubeta mantiene el techo donde esta.
 *
 * Por IP y no por usuario: estas lecturas las hace tambien quien no ha entrado.
 *
 * Ojo con lo que esto NO cubre: la defensa real de este modulo esta en la base
 * —toda escritura entra por RPC SECURITY DEFINER y `authenticated` no tiene
 * INSERT/UPDATE/DELETE sobre las cinco tablas— pero eso protege ESCRITURAS,
 * no el raspado de lecturas.
 */
async function frenoDeLectura(): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = getClientIp(await headers());
  return enforce(readHeavyRateLimit, `read:${ip}`);
}

export async function estadoCuotaFundacion(): Promise<EstadoCuotaFundacion> {
  // Sin freno devuelve el estado neutro: esta lectura solo pinta un contador,
  // y la RPC de fundar es la que de verdad decide.
  if (!(await frenoDeLectura()).ok) return leerEstadoCuota(null);
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
): Promise<{ error: string } | { data: { soy_miembro: boolean; miembros_count: number; archivada: boolean } }> {
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
  await revalidatePath(`/comunidades/${communityId}`);
  await revalidatePath("/");
  return {
    data: {
      soy_miembro: leerBooleano(data, "soy_miembro", false),
      miembros_count: leerNumero(data, "miembros_count", 0),
      // true si al salir la comunidad se archivo (quien salia era la unica
      // persona): el boton lo dice en vez de "Saliste de X".
      archivada: leerBooleano(data, "archivada", false),
    },
  };
}

/**
 * La RPC responde 22023 con estos dos textos cuando solicitar NO es el camino:
 * la comunidad es publica, o el pase de una aceptacion anterior sigue
 * vigente. En los dos casos se entra directo con alternar_membresia_comunidad,
 * asi que la accion lo devuelve como dato (`entrarDirecto`) y no como error.
 */
const ENTRADA_DIRECTA_RE = /puedes (unirte|entrar) directamente\.$/;

export async function solicitarUnion(input: {
  community_id: string;
  mensaje?: string | null;
}): Promise<{ error: string } | { data: { id: string; repetida: boolean; entrarDirecto: boolean } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };
  const parsed = solicitarUnionComunidadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };

  const { data, error } = await s.supabase.rpc("solicitar_union_comunidad", {
    p_community_id: parsed.data.community_id,
    p_mensaje: parsed.data.mensaje ?? undefined,
  });
  if (error) {
    if (error.code === CODIGO_ARGUMENTO && ENTRADA_DIRECTA_RE.test(error.message ?? "")) {
      return { data: { id: "", repetida: false, entrarDirecto: true } };
    }
    reportarSiInesperado(error, "solicitar_union_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo enviar la solicitud. Intenta de nuevo." };
  await revalidatePath(`/comunidades/${parsed.data.community_id}`);
  return { data: { id, repetida: leerBooleano(data, "repetida", false), entrarDirecto: false } };
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
    await revalidatePath(`/comunidades/${communityId}`);
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
    await revalidatePath(`/comunidades/${communityId}`);
  }
  await revalidatePath("/");
  return { data: { cancelada: true } };
}

const SOLICITUD_YA_RESUELTA_RE = /Esa solicitud (no existe|ya no esta pendiente).$/;

export async function resolverSolicitud(input: {
  request_id: string;
  aceptar: boolean;
  community_id: string;
}): Promise<{ error: string } | { data: { status: string; resueltaPorOtro: boolean } }> {
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
    // P0002 con estos dos textos: la solicitud ya no esta pendiente (otra
    // persona del mando la resolvio a la vez, o quien pedia la cancelo) o ya
    // no existe. No es un fallo de quien toca: la cola tiene que soltar la
    // fila, no reinsertarla. El tercer P0002 de la RPC ('ya no se puede
    // aceptar': bloqueo o suspension) deja la fila pendiente y sigue siendo
    // error.
    if (error.code === CODIGO_NO_EXISTE && SOLICITUD_YA_RESUELTA_RE.test(error.message ?? "")) {
      return { data: { status: "resuelta_por_otro", resueltaPorOtro: true } };
    }
    reportarSiInesperado(error, "resolver_solicitud_union");
    return { error: traducirErrorComunidad(error) };
  }
  if (uuid.safeParse(input.community_id).success) {
    await revalidatePath(`/comunidades/${input.community_id}`);
    await revalidatePath(`/comunidades/${input.community_id}/administrar`);
  }
  return {
    data: {
      status: leerTexto(data, "status") ?? (input.aceptar ? "aceptada" : "rechazada"),
      resueltaPorOtro: false,
    },
  };
}

export async function cargarSolicitudes(input: {
  community_id: string;
  cursor: CursorComunidad | null;
  limit?: number;
}): Promise<{ items: SolicitudEnCola[]; nextCursor: CursorComunidad | null; error?: string }> {
  const freno = await frenoDeLectura();
  if (!freno.ok) return { items: [], nextCursor: null, error: freno.error };
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
  await revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
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
  await revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
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
  await revalidatePath(`/comunidades/${parsed.data.community_id}`);
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
  await revalidatePath(`/comunidades/${parsed.data.community_id}`);
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
  await revalidatePath(`/comunidades/${parsed.data.community_id}/administrar`);
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
  await revalidatePath(`/comunidades/${communityId}`);
  await revalidatePath("/");
  return { data: { archivada: leerBooleano(data, "archivada", true) } };
}

// ─── PUBLICACIONES Y COMENTARIOS ───────────────────────────────────────────

/**
 * Con imagenes el texto puede ir vacio, y publicarEnComunidadSchema exige un
 * caracter. Ese esquema vive en @vicino/shared y no se toca desde aqui, asi que
 * el camino con imagenes usa este espejo: mismo tope y mismo recorte que la
 * base (btrim antes de medir), sin el minimo.
 */
const textoJuntoAImagenes = z
  .string()
  .trim()
  .max(COMMUNITY_POST_MAX, `El texto no puede pasar de ${COMMUNITY_POST_MAX} caracteres`);

/**
 * Las rutas que manda el cliente, comprobadas de nuevo aqui.
 *
 * Que la RPC tambien las valide no hace esto redundante: el cliente escribe la
 * ruta que quiera y el servidor es quien la firma como propia. Se exige
 * <comunidad>/<quien publica>/ (esRutaDeAutor mira ademas el `..`), el tope de
 * cuatro y que no venga repetida -- una repetida pintaria la misma foto dos
 * veces y gastaria dos huecos del tope.
 *
 * La comunidad entra en la comprobacion porque va DENTRO de la ruta: sin ella,
 * alguien podria adjuntar a una comunidad una imagen que subio para otra, y la
 * policy de lectura del bucket -- que decide por el primer tramo -- la
 * ensenaria a quien pertenezca a la comunidad equivocada.
 *
 * Devuelve null y no una lista recortada: si algo no encaja, publicar "casi lo
 * que pediste" es peor que decir que no. Quien escribe tiene que enterarse.
 */
function rutasPropias(valor: unknown, communityId: string, userId: string): string[] | null {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) return null;
  const crudas: readonly unknown[] = valor;
  if (crudas.length > MAX_IMAGENES_POR_PUBLICACION) return null;

  const rutas: string[] = [];
  for (const item of crudas) {
    if (!esRutaDeAutor(item, communityId, userId)) return null;
    if (rutas.includes(item)) return null;
    rutas.push(item);
  }
  return rutas;
}

const ERROR_IMAGENES = "No se pudieron adjuntar las imágenes. Vuelve a elegirlas.";

/**
 * Valida cuerpo + imagenes de una publicacion o de un comentario.
 *
 * Los dos comparten tabla, CHECK y RPC, asi que comparten validador: tenerlo
 * dos veces es como acabaron divergiendo los mensajes de otros modulos.
 */
function revisarEntradaDeMuro(
  entrada: { community_id: string; parent_post_id: string | null; texto: string; imagenes?: string[] },
  userId: string,
): { error: string } | { texto: string; rutas: string[] } {
  const rutas = rutasPropias(entrada.imagenes, entrada.community_id, userId);
  if (rutas === null) return { error: ERROR_IMAGENES };

  if (rutas.length === 0) {
    // Sin imagenes NADA cambia: el esquema compartido de siempre, con su
    // mensaje de siempre.
    const parsed =
      entrada.parent_post_id === null
        ? publicarEnComunidadSchema.safeParse({ community_id: entrada.community_id, texto: entrada.texto })
        : comentarPublicacionSchema.safeParse({
            community_id: entrada.community_id,
            parent_post_id: entrada.parent_post_id,
            texto: entrada.texto,
          });
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
    return { texto: parsed.data.texto, rutas: [] };
  }

  if (!uuid.safeParse(entrada.community_id).success) return { error: "Comunidad inválida." };
  if (entrada.parent_post_id !== null && !uuid.safeParse(entrada.parent_post_id).success) {
    return { error: "Publicación inválida." };
  }
  const texto = textoJuntoAImagenes.safeParse(entrada.texto ?? "");
  if (!texto.success) return { error: texto.error.errors[0]?.message ?? "Datos inválidos" };
  return { texto: texto.data, rutas };
}

/**
 * p_imagenes viaja SIEMPRE, incluso vacio.
 *
 * No es cosmetico: si la migracion hiciera CREATE OR REPLACE sin el DROP de la
 * firma vieja de tres argumentos, quedarian dos funciones y una llamada con
 * solo tres nombres encajaria en las dos -- PostgREST responde 300. Nombrando
 * los cuatro, la llamada solo puede resolver a la nueva.
 */
function argsPublicar(
  communityId: string,
  texto: string,
  rutas: string[],
  parentPostId: string | null,
): Database["public"]["Functions"]["publicar_en_comunidad"]["Args"] {
  const base: Database["public"]["Functions"]["publicar_en_comunidad"]["Args"] = {
    p_community_id: communityId,
    p_texto: texto,
    p_imagenes: rutas,
  };
  // undefined omite el argumento y Postgres aplica su DEFAULT NULL, que es
  // exactamente "esto es una publicacion de muro, no un comentario".
  return parentPostId === null ? base : { ...base, p_parent_post_id: parentPostId };
}

export async function publicarEnComunidad(input: {
  community_id: string;
  texto: string;
  /** Rutas del bucket community-media, ya subidas por el cliente. */
  imagenes?: string[];
}): Promise<{ error: string } | { data: { id: string; created_at: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };

  const revisada = revisarEntradaDeMuro(
    { community_id: input.community_id, parent_post_id: null, texto: input.texto, imagenes: input.imagenes },
    s.userId,
  );
  if ("error" in revisada) {
    // Una ruta rechazada no es un rechazo esperado como una cuota: significa
    // que el cliente mando algo que no deberia poder mandar.
    if (revisada.error === ERROR_IMAGENES) {
      reportarSiInesperado({ message: "rutas de imagen rechazadas al publicar" }, "publicar_en_comunidad@imagenes");
    }
    return { error: revisada.error };
  }

  const { data, error } = await s.supabase.rpc(
    "publicar_en_comunidad",
    argsPublicar(input.community_id, revisada.texto, revisada.rutas, null),
  );
  if (error) {
    reportarSiInesperado(error, "publicar_en_comunidad");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo publicar. Intenta de nuevo." };
  // NO hay revalidatePath aqui, y es deliberado: el muro pinta la fila nueva de
  // forma optimista con lo que devuelve esta RPC. Purgar la ruta obligaria a
  // volver a renderizar el muro entero para ensenar lo que ya esta en pantalla.
  return { data: { id, created_at: leerTexto(data, "created_at") ?? new Date().toISOString() } };
}

export async function comentarPublicacion(input: {
  community_id: string;
  parent_post_id: string;
  texto: string;
  /** Rutas del bucket community-media, ya subidas por el cliente. */
  imagenes?: string[];
}): Promise<{ error: string } | { data: { id: string; created_at: string } }> {
  const s = await sesionYFreno();
  if (!s.ok) return { error: s.error };

  const revisada = revisarEntradaDeMuro(
    {
      community_id: input.community_id,
      parent_post_id: input.parent_post_id,
      texto: input.texto,
      imagenes: input.imagenes,
    },
    s.userId,
  );
  if ("error" in revisada) {
    if (revisada.error === ERROR_IMAGENES) {
      reportarSiInesperado({ message: "rutas de imagen rechazadas al comentar" }, "publicar_en_comunidad@comentar-imagenes");
    }
    return { error: revisada.error };
  }

  const { data, error } = await s.supabase.rpc(
    "publicar_en_comunidad",
    argsPublicar(input.community_id, revisada.texto, revisada.rutas, input.parent_post_id),
  );
  if (error) {
    reportarSiInesperado(error, "publicar_en_comunidad@comentar");
    return { error: traducirErrorComunidad(error) };
  }
  const id = leerTexto(data, "id");
  if (!id) return { error: "No se pudo comentar. Intenta de nuevo." };
  // Igual que al publicar: el hilo anade el comentario en pantalla con esta
  // respuesta, asi que no se purga la ruta.
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
  const freno = await frenoDeLectura();
  if (!freno.ok) return { items: [], nextCursor: null, error: freno.error };
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
  const freno = await frenoDeLectura();
  if (!freno.ok) return { items: [], nextCursor: null, error: freno.error };
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
  const freno = await frenoDeLectura();
  if (!freno.ok) return { items: [], nextCursor: null, error: freno.error };
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
  const freno = await frenoDeLectura();
  if (!freno.ok) return { items: [], error: freno.error };
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
