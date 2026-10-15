/** A selected point can be saved before its readable address is available. */
export const PUBLIC_LOCATION_FALLBACK = "Zona seleccionada en el mapa";

/**
 * Recognize decimal coordinate pairs, including Apple's fallback with a CP.
 * Do not treat ordinary street numbers or locality names as coordinates.
 */
export function containsCoordinatePair(value: string): boolean {
  const pairs = value.matchAll(/(?:^|[^\d.])([+-]?\d{1,3}\.\d+)\s*,\s*([+-]?\d{1,3}\.\d+)(?![\d.])/g);
  for (const pair of pairs) {
    const lat = Number(pair[1]);
    const lng = Number(pair[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return true;
  }
  return false;
}

export function publicLocationLabel(value?: string | null): string {
  const label = value?.trim();
  return label && !containsCoordinatePair(label) ? label : PUBLIC_LOCATION_FALLBACK;
}
