import type { Database } from "@/types/database.types";

export type ProductoChat = Pick<Database["public"]["Tables"]["products_services"]["Row"],
  "id" | "titulo" | "precio" | "modo_precio" | "imagen_principal" | "creador_id" | "estatus" | "is_hidden">;
export type ProductoActivoChat = { product: ProductoChat | null; revision: number };

export function productoElegible(product: ProductoChat | null, participants: string[]) {
  return !!product && product.estatus === "disponible" && !product.is_hidden && participants.includes(product.creador_id);
}

/** Realtime y respuestas HTTP pueden llegar desordenadas; la revision del
 * servidor impide restaurar un producto anterior, incluso en cambios A-B-A. */
export function reconciliarProducto(previous: ProductoActivoChat, next: ProductoActivoChat): ProductoActivoChat {
  return next.revision >= previous.revision ? next : previous;
}
