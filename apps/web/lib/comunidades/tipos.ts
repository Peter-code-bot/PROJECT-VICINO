/**
 * Tipos de comunidades, derivados de los RETURNS generados de cada RPC.
 *
 * Se derivan y no se escriben a mano por lo mismo que en solicitudes-feed:
 * si el backend cambia un RETURNS y se regeneran los tipos, esto deja de
 * compilar en el sitio exacto, en vez de fallar en runtime con un campo
 * undefined.
 */
import type { Database } from "@/types/database.types";

type Funciones = Database["public"]["Functions"];

/** Fila del muro (feed_muro_comunidad y feed_comunidades_explorar comparten forma). */
export type PostComunidad = Funciones["feed_muro_comunidad"]["Returns"][number];

/** Fila del hilo de comentarios. */
export type ComentarioComunidad = Funciones["comentarios_de_publicacion"]["Returns"][number];

/** Tarjeta de comunidad: mis_comunidades y descubrir_comunidades comparten
 *  los campos de relacion; descubrir anade distancia_m. */
export type ComunidadMia = Funciones["mis_comunidades"]["Returns"][number];
export type ComunidadCercana = Funciones["descubrir_comunidades"]["Returns"][number];
export type ComunidadResumen = ComunidadMia | ComunidadCercana;

/** Cabecera de /comunidades/[id]. */
export type DetalleComunidad = Funciones["detalle_comunidad"]["Returns"][number];

/** Fila de la cola de solicitudes (owner/moderadores). */
export type SolicitudEnCola = Funciones["solicitudes_de_comunidad"]["Returns"][number];

/** Mis solicitudes (pendientes y resueltas). */
export type SolicitudMia = Funciones["mis_solicitudes_union"]["Returns"][number];

/** Centro y cuota de movimientos (solo owner). */
export type CentroComunidad = Funciones["centro_de_mi_comunidad"]["Returns"][number];

/** Miembro vivo, leido por REST (policy: el padron si modero). */
export interface MiembroComunidad {
  user_id: string;
  role: string;
  joined_at: string;
  nombre: string;
  foto: string | null;
}

/** Respuesta de estado_cuota_fundacion(), comprobada en la frontera. */
export interface EstadoCuotaFundacion {
  puede_fundar: boolean;
  motivo: string | null;
  siguiente_en: string | null;
  fundadas_vivas: number;
  tope_vivas: number;
}

/** Cursor de paginacion (created_at, id), el mismo par en todas las RPC. */
export interface CursorComunidad {
  time: string;
  id: string;
}

/** Tamano de pagina compartido por el muro y las paginas que lo pintan. */
export const PAGINA_MURO = 30;

/**
 * Cursor para pedir la siguiente pagina: solo si la pagina vino llena. Vive
 * aqui (modulo sin "use client") porque lo llaman Server Components: una
 * funcion exportada desde un modulo cliente no se puede invocar en el
 * servidor (React lanza "Attempted to call ... from the server") y tsc no
 * lo detecta.
 */
export function cursorDeUltimo(posts: PostComunidad[], pagina: number = PAGINA_MURO): CursorComunidad | null {
  const ultimo = posts[posts.length - 1];
  return posts.length === pagina && ultimo ? { time: ultimo.created_at, id: ultimo.id } : null;
}

export type RolComunidad = "owner" | "moderator" | "member";

export function esMando(rol: string | null | undefined): boolean {
  return rol === "owner" || rol === "moderator";
}

/**
 * Comprueba la respuesta jsonb de estado_cuota_fundacion() sin darla por
 * buena: la RPC devuelve Json, y el boton de fundar se deshabilita con esto.
 * Si la forma no encaja se asume que SI se puede fundar y que la base diga
 * que no: un estado desconocido no debe bloquear a nadie.
 */
export function leerEstadoCuota(json: unknown): EstadoCuotaFundacion {
  const abierto: EstadoCuotaFundacion = {
    puede_fundar: true,
    motivo: null,
    siguiente_en: null,
    fundadas_vivas: 0,
    tope_vivas: 0,
  };
  if (!json || typeof json !== "object" || Array.isArray(json)) return abierto;
  const o = json as Record<string, unknown>;
  return {
    puede_fundar: typeof o.puede_fundar === "boolean" ? o.puede_fundar : true,
    motivo: typeof o.motivo === "string" ? o.motivo : null,
    siguiente_en: typeof o.siguiente_en === "string" ? o.siguiente_en : null,
    fundadas_vivas: typeof o.fundadas_vivas === "number" ? o.fundadas_vivas : 0,
    tope_vivas: typeof o.tope_vivas === "number" ? o.tope_vivas : 0,
  };
}

/** Lee un campo booleano de una respuesta jsonb, con valor por defecto. */
export function leerBooleano(json: unknown, clave: string, porDefecto: boolean): boolean {
  if (!json || typeof json !== "object" || Array.isArray(json)) return porDefecto;
  const v = (json as Record<string, unknown>)[clave];
  return typeof v === "boolean" ? v : porDefecto;
}

/** Lee un campo numerico de una respuesta jsonb, con valor por defecto. */
export function leerNumero(json: unknown, clave: string, porDefecto: number): number {
  if (!json || typeof json !== "object" || Array.isArray(json)) return porDefecto;
  const v = (json as Record<string, unknown>)[clave];
  return typeof v === "number" && Number.isFinite(v) ? v : porDefecto;
}

/** Lee un campo de texto de una respuesta jsonb, o null. */
export function leerTexto(json: unknown, clave: string): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>)[clave];
  return typeof v === "string" ? v : null;
}
