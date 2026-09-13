import { z } from "zod";

/**
 * Esquemas Zod de comunidades hiperlocales.
 *
 * LOS LIMITES REALES VIVEN EN LA BASE, no aqui. Estos esquemas son un espejo
 * para dar un error legible ANTES de gastar una peticion (y una cuota): si
 * alguien los salta, la RPC y los CHECK de la tabla rechazan igual con 22023 o
 * 23514. Cada numero de abajo copia uno de estos sitios; si cambian alla,
 * cambian aqui:
 *
 *   - communities_nombre_largo        char_length(btrim(nombre)) between 3 and 40
 *   - communities_nombre_una_linea    sin \n, \r ni \t
 *   - communities_descripcion_larga   descripcion is null or char_length <= 300
 *   - community_posts_cuerpo_largo    char_length(btrim(cuerpo)) between 1 and 1500
 *     (vale para publicacion Y comentario: son la misma tabla y la misma RPC,
 *     publicar_en_comunidad, con p_parent_post_id lleno para el comentario)
 *   - community_join_requests_mensaje_largo   mensaje is null or char_length <= 200
 *   - fundar_comunidad / editar_centro_comunidad   lat en [-90,90], lng en [-180,180],
 *     NaN rechazado; el limite de 1 km del centro se mide EN LA BASE contra
 *     centro_fundacion (23514), aqui no se puede porque el cliente no lo conoce.
 *
 * Fuente: supabase/migrations/20260912200000_comunidades_base.sql y
 * supabase/migrations/20260912230000_comunidades_visibilidad_solicitudes_moderadores_centro.sql.
 *
 * Los trim() van en el esquema porque la base tambien recorta (btrim) antes de
 * medir: "   ab   " mide 2 alla, y tiene que medir 2 aqui.
 */

export const COMMUNITY_NOMBRE_MIN = 3;
export const COMMUNITY_NOMBRE_MAX = 40;
export const COMMUNITY_DESCRIPCION_MAX = 300;
export const COMMUNITY_POST_MAX = 1500;
export const COMMUNITY_JOIN_MESSAGE_MAX = 200;
/** Radio maximo (metros) al mover el centro; espejo de comunidades_limite('centro_radio_metros'). Solo informativo para la UI. */
export const COMMUNITY_CENTRO_RADIO_METROS = 1000;

const latitud = z
  .number({ invalid_type_error: "Ubicación inválida" })
  .finite("Ubicación inválida")
  .min(-90, "Ubicación inválida")
  .max(90, "Ubicación inválida");

const longitud = z
  .number({ invalid_type_error: "Ubicación inválida" })
  .finite("Ubicación inválida")
  .min(-180, "Ubicación inválida")
  .max(180, "Ubicación inválida");

/** Un nombre es una sola linea: sin saltos ni tabuladores (communities_nombre_una_linea). */
const nombreComunidad = z
  .string({ required_error: "Escribe un nombre" })
  .trim()
  .min(COMMUNITY_NOMBRE_MIN, `El nombre debe tener entre ${COMMUNITY_NOMBRE_MIN} y ${COMMUNITY_NOMBRE_MAX} caracteres`)
  .max(COMMUNITY_NOMBRE_MAX, `El nombre debe tener entre ${COMMUNITY_NOMBRE_MIN} y ${COMMUNITY_NOMBRE_MAX} caracteres`)
  .refine((v) => !/[\n\r\t]/.test(v), "El nombre debe ser una sola línea");

/** Cadena vacia -> null, igual que NULLIF(btrim(...), '') en la RPC. */
const descripcionComunidad = z
  .string()
  .trim()
  .max(COMMUNITY_DESCRIPCION_MAX, `La descripción no puede pasar de ${COMMUNITY_DESCRIPCION_MAX} caracteres`)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** fundar_comunidad(p_nombre, p_lat, p_lng, p_descripcion) + editar_visibilidad_comunidad. */
export const fundarComunidadSchema = z.object({
  nombre: nombreComunidad,
  descripcion: descripcionComunidad,
  lat: latitud,
  lng: longitud,
  // Decision 4: publica por defecto; cerrarla es un acto deliberado.
  es_privada: z.boolean().default(false),
});

/** editar_descripcion_comunidad(p_community_id, p_descripcion). */
export const editarDescripcionComunidadSchema = z.object({
  community_id: z.string().uuid(),
  descripcion: descripcionComunidad,
});

/** editar_visibilidad_comunidad(p_community_id, p_privada). */
export const editarVisibilidadComunidadSchema = z.object({
  community_id: z.string().uuid(),
  es_privada: z.boolean(),
});

const cuerpoPublicacion = z
  .string({ required_error: "Escribe algo" })
  .trim()
  .min(1, "Escribe algo")
  .max(COMMUNITY_POST_MAX, `El texto no puede pasar de ${COMMUNITY_POST_MAX} caracteres`);

/** publicar_en_comunidad(p_community_id, p_texto) con p_parent_post_id NULL. */
export const publicarEnComunidadSchema = z.object({
  community_id: z.string().uuid(),
  texto: cuerpoPublicacion,
});

/**
 * publicar_en_comunidad(p_community_id, p_texto, p_parent_post_id). Mismo
 * limite que la publicacion: comparten tabla, CHECK y RPC. Profundidad 1: la
 * RPC rechaza responder a un comentario, aqui solo se exige el padre.
 */
export const comentarPublicacionSchema = z.object({
  community_id: z.string().uuid(),
  parent_post_id: z.string().uuid(),
  texto: cuerpoPublicacion,
});

/** solicitar_union_comunidad(p_community_id, p_mensaje). */
export const solicitarUnionComunidadSchema = z.object({
  community_id: z.string().uuid(),
  mensaje: z
    .string()
    .trim()
    .max(COMMUNITY_JOIN_MESSAGE_MAX, `El mensaje no puede pasar de ${COMMUNITY_JOIN_MESSAGE_MAX} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});

/** resolver_solicitud_union(p_request_id, p_aceptar) y cancelar_solicitud_union(p_request_id). */
export const solicitudUnionIdSchema = z.object({
  request_id: z.string().uuid(),
});

/** nombrar_moderador_comunidad / quitar_moderador_comunidad (p_community_id, p_user_id). */
export const moderadorComunidadSchema = z.object({
  community_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

/**
 * editar_centro_comunidad(p_community_id, p_lat, p_lng). El tope de 1 km desde
 * centro_fundacion NO se valida aqui: lo mide la base (23514) porque el
 * cliente no conoce el punto de fundacion crudo.
 */
export const editarCentroComunidadSchema = z.object({
  community_id: z.string().uuid(),
  lat: latitud,
  lng: longitud,
});

export type FundarComunidadInput = z.infer<typeof fundarComunidadSchema>;
export type EditarDescripcionComunidadInput = z.infer<typeof editarDescripcionComunidadSchema>;
export type EditarVisibilidadComunidadInput = z.infer<typeof editarVisibilidadComunidadSchema>;
export type PublicarEnComunidadInput = z.infer<typeof publicarEnComunidadSchema>;
export type ComentarPublicacionInput = z.infer<typeof comentarPublicacionSchema>;
export type SolicitarUnionComunidadInput = z.infer<typeof solicitarUnionComunidadSchema>;
export type SolicitudUnionIdInput = z.infer<typeof solicitudUnionIdSchema>;
export type ModeradorComunidadInput = z.infer<typeof moderadorComunidadSchema>;
export type EditarCentroComunidadInput = z.infer<typeof editarCentroComunidadSchema>;
