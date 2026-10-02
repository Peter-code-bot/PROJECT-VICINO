/**
 * Paginas que tienen que abrirse aunque la persona no haya terminado el
 * onboarding: el alta de vendedor enlaza a Terminos y Aviso de Privacidad para
 * que los acepte, y /eliminar-cuenta es la pagina publica de baja que piden las
 * tiendas. El layout de (marketplace) las exime del paso a /bienvenida.
 *
 * Modulo puro (sin next/headers): lo importan el proxy, el layout y su prueba.
 */

/** Cabecera con la ruta real que el proxy pasa a los Server Components. */
export const CABECERA_RUTA = "x-vicino-ruta";

const RUTAS_LEGALES = ["/terminos", "/privacidad", "/eliminar-cuenta"] as const;

export function esRutaLegal(ruta: string): boolean {
  ruta = ruta.split(/[?#]/, 1)[0] ?? "";
  return RUTAS_LEGALES.some((base) => ruta === base || ruta.startsWith(`${base}/`));
}
