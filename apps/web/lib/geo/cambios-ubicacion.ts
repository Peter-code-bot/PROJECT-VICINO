/**
 * Si la hoja "Cambiar ubicación" tiene algo que aplicar (Tarea 8, 27-sep).
 * Con cambios, la X del header pasa a palomita y aplica; sin cambios cierra.
 * Pura para poder probarla sin React ni MapKit.
 */

type Punto = { lat: number; lng: number };

/**
 * Tolerancia contra la ubicacion ACTIVA. La cookie `vicino_location` guarda 3
 * decimales (~110 m, a proposito) y readLocation devuelve esas coordenadas,
 * asi que un punto elegido con precision completa difiere hasta 0.0005 del que
 * vuelve al recargar. Con ~11 m la ubicacion actual nunca "coincidia" consigo
 * misma: la marca de recientes desaparecia y la palomita se encendia sola.
 */
export const TOLERANCIA_UBICACION = 0.0006;
/** Radio que la hoja da por hecho cuando la ubicación activa no trae uno. */
export const RADIO_POR_DEFECTO = 10000;

export function mismoPunto(a: Punto | null | undefined, b: Punto | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.lat - b.lat) < TOLERANCIA_UBICACION &&
    Math.abs(a.lng - b.lng) < TOLERANCIA_UBICACION
  );
}

/**
 * Hay cambios si el borrador es un punto válido y distinto de la ubicación
 * activa, o si el radio cambió. Sin borrador no hay nada que aplicar (ni
 * siquiera un radio: aplicar exige un punto). Volver al punto y radio de
 * antes cuenta como "sin cambios".
 */
export function hayCambiosDeUbicacion(
  borrador: Punto | null | undefined,
  radioBorrador: number,
  activa: (Punto & { radius?: number | null }) | null | undefined,
): boolean {
  if (!borrador || !Number.isFinite(borrador.lat) || !Number.isFinite(borrador.lng)) return false;
  if (!mismoPunto(borrador, activa)) return true;
  return radioBorrador !== (activa?.radius ?? RADIO_POR_DEFECTO);
}
