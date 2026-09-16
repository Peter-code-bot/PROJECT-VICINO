import type { ProductDetailProduct } from "@/components/product/types";
const fields = [
  "id", "slug", "titulo", "descripcion", "precio", "modo_precio", "precio_negociable",
  "categoria", "tipo", "estado", "color", "estatus", "ubicacion", "tipo_entrega",
  "imagen_principal", "galeria_imagenes", "gallery_sizes", "creador_id", "vistas_count",
  "allow_appointments", "appointment_start_time", "appointment_end_time",
  "appointment_duration_minutes", "created_at", "updated_at",
] as const satisfies ReadonlyArray<keyof ProductDetailProduct>;

/** Runtime allowlist; a future widened SELECT cannot leak private geometry into RSC. */
export function publicProduct(row: Record<string, unknown>): ProductDetailProduct {
  return Object.fromEntries(fields.map(field => [field, row[field]])) as unknown as ProductDetailProduct;
}
