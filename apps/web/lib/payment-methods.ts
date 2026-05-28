/**
 * Defensive parser for the seller's metodos_pago_aceptados column, which is
 * stored as TEXT (comma-separated string) in the profiles table. Future
 * migrations might promote it to text[]; this helper tolerates both shapes
 * plus null/empty values without throwing.
 */
export function parsePaymentMethods(
  value: string | string[] | null | undefined,
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => v.trim()).filter(Boolean);
  }
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
