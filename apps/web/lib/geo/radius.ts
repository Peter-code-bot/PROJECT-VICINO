/**
 * Lectura del radio de busqueda guardado en la cookie `vicino_radius`.
 *
 * Existe porque habia CUATRO implementaciones de esto, y no coincidian:
 *
 *   app/(marketplace)/page.tsx            acotaba y usaba 10000 por defecto  ✓
 *   app/(marketplace)/buscar/page.tsx     acotaba, pero una cookie corrupta
 *                                         daba NaN: comprobaba que la cookie
 *                                         existiera, no que fuera un numero
 *   app/(marketplace)/rankings/page.tsx   NO acotaba
 *   components/rankings/rankings-home-strip.tsx  NO acotaba
 *
 * Un radio sin acotar no rompe el feed —search_nearby_products_v4 vuelve a
 * acotarlo con LEAST/GREATEST del lado del servidor— pero si viaja por otros
 * caminos, y un NaN llega al RPC como parametro invalido. Que el limite viva en
 * dos sitios que pueden divergir es justamente como aparecio el P0 del feed en
 * agosto: `const validRadius = 2000` en una pagina, 50 km en la preferencia del
 * usuario.
 *
 * Los limites coinciden a proposito con los del RPC: si algun dia cambian alli,
 * cambian aqui, y el desajuste se ve en un solo archivo.
 */

/** Minimo del RPC: por debajo, ST_DWithin devuelve un vecindario inutilmente chico. */
export const RADIUS_MIN_METERS = 1000;

/** Maximo del RPC. Mas alla, la consulta deja de ser "cerca de ti". */
export const RADIUS_MAX_METERS = 50000;

/** Lo que ve alguien que nunca ha tocado su preferencia. */
export const RADIUS_DEFAULT_METERS = 10000;

/**
 * Convierte el valor crudo de la cookie en un radio utilizable.
 *
 * Devuelve el default cuando la cookie falta, esta vacia, o no es un numero
 * finito — incluido el caso de `parseInt` sobre basura, que devuelve NaN y que
 * antes se colaba hasta el RPC.
 */
export function parseRadiusCookie(raw: string | undefined | null): number {
  if (!raw) return RADIUS_DEFAULT_METERS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return RADIUS_DEFAULT_METERS;

  return Math.min(Math.max(parsed, RADIUS_MIN_METERS), RADIUS_MAX_METERS);
}
