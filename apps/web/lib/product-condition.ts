/**
 * Display labels for the product condition column (products_services.estado).
 *
 * DB stores snake_case values constrained by:
 *   products_services_estado_check CHECK (estado IS NULL OR estado IN (
 *     'nuevo','como_nuevo','bueno','aceptable','para_piezas'
 *   ))
 *
 * UI uses formatProductCondition() to render the friendly display value
 * so the storage format and the rendered string stay decoupled.
 */

export const PRODUCT_CONDITION_VALUES = [
  "nuevo",
  "como_nuevo",
  "bueno",
  "aceptable",
  "para_piezas",
] as const;

export type ProductCondition = (typeof PRODUCT_CONDITION_VALUES)[number];

export const PRODUCT_CONDITION_LABELS: Record<ProductCondition, string> = {
  nuevo: "Nuevo",
  como_nuevo: "Como nuevo",
  bueno: "Bueno",
  aceptable: "Aceptable",
  para_piezas: "Para piezas",
};

export function formatProductCondition(estado: string | null): string {
  if (!estado) return "—";
  return (
    PRODUCT_CONDITION_LABELS[estado as ProductCondition] ?? estado
  );
}

export function isProductCondition(value: unknown): value is ProductCondition {
  return (
    typeof value === "string" &&
    (PRODUCT_CONDITION_VALUES as readonly string[]).includes(value)
  );
}
