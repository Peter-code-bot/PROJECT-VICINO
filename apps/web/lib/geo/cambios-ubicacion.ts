/**
 * Comparación contra la ubicación aplicada, usando la precisión de la cookie.
 */

type Punto = { lat: number; lng: number };

/**
 * La cookie `vicino_location` guarda 3 decimales (~110 m). La identidad de un
 * punto debe usar exactamente ese redondeo, también al deduplicar recientes.
 */
/** Radio que la hoja da por hecho cuando la ubicación activa no trae uno. */
export const RADIO_POR_DEFECTO = 10000;

export function mismoPunto(a: Punto | null | undefined, b: Punto | null | undefined): boolean {
  if (!a || !b) return false;
  return Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(b.lat) && Number.isFinite(b.lng)
    && a.lat.toFixed(3) === b.lat.toFixed(3) && a.lng.toFixed(3) === b.lng.toFixed(3);
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
