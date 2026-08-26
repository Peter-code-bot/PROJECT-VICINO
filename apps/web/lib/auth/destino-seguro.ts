/**
 * Destino interno seguro a partir de un ?next= que viene de la URL.
 *
 * Vive en su propio modulo para poder probarse. Un parametro de redireccion
 * que se obedece a ciegas es una redireccion abierta: basta //otro.example
 * para que el navegador lo lea como otro dominio y mande ahi al usuario
 * recien autenticado. El fallo no se ve en pantalla, solo lo ve quien lo
 * explota.
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return "/";
  // Tiene que ser una ruta interna.
  if (!next.startsWith("/")) return "/";
  // //host y /\/host se leen como otro dominio.
  if (next.startsWith("//")) return "/";
  // Algunos navegadores normalizan la barra invertida a barra: /\/host
  // acabaria siendo //host.
  if (next.includes(BARRA_INVERTIDA)) return "/";
  return next;
}

/** Construida y no escrita: escapar barras dentro de literales es donde mas
 *  facil es equivocarse, y el error no falla, solo cambia lo que casa. */
const BARRA_INVERTIDA = String.fromCharCode(92);
