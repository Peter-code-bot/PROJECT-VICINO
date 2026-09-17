/**
 * Marca de «esto es una navegacion de pestaña», para restaurar la interfaz al
 * volver (hoy: la posicion de scroll).
 *
 * Los enlaces de la barra inferior, la barra lateral y el gesto de deslizar
 * marcan la navegacion ANTES de navegar y navegan con `scroll: false`, porque
 * Next hace su scroll al inicio en un efecto que corre DESPUES de los efectos
 * de layout de la pagina: restaurar antes es imposible y restaurar despues se
 * ve como un salto. El consumidor de la pestaña (SessionScroll) consume la
 * marca en un efecto de layout y coloca el scroll donde estaba, antes de
 * pintar. Un enlace cualquiera a la misma ruta —el logo, un «Ver mas»— no
 * marca nada y conserva el scroll-al-inicio de siempre.
 *
 * La posicion en si NO vive aqui: vive en `cache.ui` de SessionCache, que es
 * por cuenta y se vacia con la sesion. Este modulo solo sabe si la navegacion
 * en curso es de pestaña, y por eso no guarda nada de nadie.
 */

/** Una marca sin consumir en este tiempo se considera de una navegacion que no llego. */
const VIGENCIA_MS = 10_000;

/**
 * - `restaurar`: navegacion de pestaña vigente hacia esta ruta.
 * - `arriba`: hubo navegacion de pestaña, pero la marca ya no sirve (caducada,
 *   o era hacia otra ruta). Como esas navegaciones van con `scroll: false`,
 *   alguien tiene que subir arriba o la pestaña nueva heredaria el scroll de
 *   la anterior.
 * - `nada`: no fue una navegacion de pestaña; Next ya hizo su scroll.
 */
export type Restauracion = "restaurar" | "arriba" | "nada";

let pendiente: { ruta: string; desde: number } | null = null;

export function marcarRestauracionPendiente(ruta: string, ahora: number = Date.now()): void {
  pendiente = { ruta, desde: ahora };
}

export function consumirRestauracion(ruta: string, ahora: number = Date.now()): Restauracion {
  if (!pendiente) return "nada";
  const marca = pendiente;
  pendiente = null;
  if (marca.ruta !== ruta) return "arriba";
  return ahora - marca.desde <= VIGENCIA_MS ? "restaurar" : "arriba";
}

export function vaciarRestauracion(): void {
  pendiente = null;
}
