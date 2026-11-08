/**
 * `sanitizeBody` para @supabase/sentry-js-integration: columnas (y argumentos
 * de RPC) cuyo valor no debe salir hacia Sentry dentro del cuerpo de una
 * peticion a PostgREST.
 *
 * Como viaja hoy el cuerpo (leido en node_modules/@supabase/sentry-js-integration
 * 0.3.0; la firma esta en index.d.ts:11 y el uso en v8.js):
 * - La opcion es `sanitizeBody(table, key, value)`. Se llama una vez por cada
 *   clave de PRIMER nivel del cuerpo, y solo si el cuerpo es un objeto plano
 *   (v8.js:125-133; un insert de varias filas, que es un array, no se adjunta
 *   nunca). Lo que devuelve sustituye al valor en la copia que se manda.
 * - `table` es el ultimo segmento de la ruta de PostgREST (v8.js:115): el
 *   nombre de la tabla en .from(), y el de la funcion en .rpc(), cuyos
 *   argumentos tambien llegan aqui como cuerpo.
 * - Esa copia va al atributo `db.body` del span (v8.js:164-166) y a
 *   `contexts.supabase.body` del error que la integracion captura cuando
 *   PostgREST responde con error (v8.js:191-203). En el navegador el span
 *   viaja tal cual dentro de la transaccion; en el servidor OpenTelemetry
 *   descarta los atributos que son objetos. En los dos, el error se normaliza
 *   a profundidad 3: un texto de primer nivel (como university_name) llega
 *   completo y un objeto (como ai_analysis_raw) llega como "[Object]" mientras
 *   nadie suba normalizeDepth.
 *
 * Un null o undefined pasa tal cual: no lleva dato y sirve para diagnosticar.
 */

export const REDACTADO = "[redactado]";

/** Para tablas en las que ninguna columna debe viajar (p. ej. la futura del OCR). */
export const TODAS_LAS_COLUMNAS = "*";

type Regla = readonly string[] | typeof TODAS_LAS_COLUMNAS;

/** Nombre de la tabla (o de la funcion RPC) -> columnas a redactar. */
export type ReglasDeRedaccion = Readonly<Record<string, Regla>>;

/**
 * Para extenderlo basta una linea por tabla. La del OCR, cuando exista su
 * migracion, deberia ir con TODAS_LAS_COLUMNAS: guarda indicadores de un
 * documento de identidad y nada de eso tiene que estar en Sentry.
 */
export const COLUMNAS_REDACTADAS: ReglasDeRedaccion = {
  // ai_analysis_raw guarda la nota completa del modelo, con el nombre leido de
  // la INE y observaciones libres; university_name es la universidad declarada.
  seller_verification: ["ai_analysis_raw", "university_name"],
};

/**
 * Coordenadas, en CUALQUIER tabla o RPC. Son argumentos de RPC que hoy viajan
 * como cuerpo: user_lat/user_lng de search_nearby_products_v4 y de
 * feed_nearby_requests_v2 (esta se llama desde el navegador,
 * hooks/use-request-page.ts, y su db.body iria en cada transaccion), p_lat/p_lng
 * de descubrir_comunidades, fundar_comunidad_v2 y editar_centro_comunidad, y
 * ubicacion_geo ("SRID=4326;POINT(lng lat)") al guardar una publicacion.
 */
export const COORDENADAS_EN_CUALQUIER_TABLA: readonly string[] = [
  "lat",
  "lng",
  "user_lat",
  "user_lng",
  "p_lat",
  "p_lng",
  "ubicacion_lat",
  "ubicacion_lng",
  "ubicacion_geo",
  "centro_lat",
  "centro_lng",
];

export type SanitizeBody = (tabla: string, clave: string, valor: unknown) => unknown;

export function crearSanitizeBody(
  reglas: ReglasDeRedaccion,
  enCualquierTabla: readonly string[] = COORDENADAS_EN_CUALQUIER_TABLA,
): SanitizeBody {
  // Map y no indexar el objeto: una tabla llamada "constructor" no debe leer Object.prototype.
  const porTabla = new Map<string, Regla>(Object.entries(reglas));
  const globales = new Set(enCualquierTabla);
  return (tabla, clave, valor) => {
    if (valor === null || valor === undefined) return valor;
    if (globales.has(clave)) return REDACTADO;
    const regla = porTabla.get(tabla);
    if (regla === undefined) return valor;
    return regla === TODAS_LAS_COLUMNAS || regla.includes(clave) ? REDACTADO : valor;
  };
}

export const sanitizeBodySupabase: SanitizeBody = crearSanitizeBody(COLUMNAS_REDACTADAS);
