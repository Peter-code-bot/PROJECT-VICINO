export interface MapPreviewError { message: string; retryable: boolean; delay: number }

/** Public messages are fixed; never render an upstream error body. */
export function mapPreviewError(status: number, code?: string, retryAfter?: string | null): MapPreviewError {
  if (status === 404) return {
    message: code === "location_missing" ? "Esta publicación no tiene una ubicación disponible." : "Mapa no disponible para esta publicación.",
    retryable: false, delay: 0,
  };
  let delay = status === 429 ? 60 : 5;
  if (retryAfter) {
    const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    if (Number.isFinite(seconds)) delay = Math.max(0, Math.ceil(seconds));
  }
  return {
    message: status === 429 ? "Hay muchas consultas al mapa. Espera un momento."
      : status === 409 ? "La ubicación cambió. Vuelve a cargar el mapa."
      : "No se pudo cargar el mapa. Intenta de nuevo.",
    retryable: true, delay,
  };
}
