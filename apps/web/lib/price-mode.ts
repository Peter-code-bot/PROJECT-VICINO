/**
 * Etiqueta de fallback del precio según products_services.modo_precio.
 *
 * El valor en DB está acotado por:
 *   products_services_modo_precio_check CHECK (
 *     modo_precio IN ('precio','cotizacion','reservacion')
 *   )
 *
 * Con modo 'precio' el fallback no debería renderizarse nunca: la constraint
 * products_services_modo_precio_coherente garantiza que precio NO sea NULL en
 * ese modo. El default "Consultar" cubre los otros dos casos posibles: una
 * superficie que todavía no selecciona modo_precio (llega null) y el defensivo
 * de precio null con modo 'precio'.
 */
export function priceFallbackLabel(modo: string | null | undefined): string {
  if (modo === "cotizacion") return "Cotización";
  if (modo === "reservacion") return "Reservación";
  return "Consultar";
}
