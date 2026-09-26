export type MotivoInactivo = "eliminado" | "pausado" | "no_disponible";

export type ClasificacionFavorito =
  | { disponible: true; motivo?: never }
  | { disponible: false; motivo: MotivoInactivo };

export interface ProductoFavoritoInput {
  estatus?: string | null;
  is_hidden?: boolean | null;
}

/**
 * Clasifica un producto vinculado a un favorito para determinar si debe
 * renderizarse con ProductCard normal o con FavoritoInactivoCard sin enlaces a 404.
 *
 * Utilizado tanto en el servidor (favoritos/page.tsx) como en suites de verificación.
 */
export function clasificarFavorito(
  product: ProductoFavoritoInput | null | undefined
): ClasificacionFavorito {
  // 1. RLS devuelve null (producto eliminado o inaccesible para este rol)
  if (!product) {
    return { disponible: false, motivo: "no_disponible" };
  }

  // 2. Producto eliminado u oculto
  if (product.estatus === "eliminado" || product.is_hidden) {
    return { disponible: false, motivo: "eliminado" };
  }

  // 3. Producto pausado por el vendedor
  if (product.estatus === "pausado") {
    return { disponible: false, motivo: "pausado" };
  }

  // 4. Cualquier otro estado no disponible
  if (product.estatus !== "disponible") {
    return { disponible: false, motivo: "no_disponible" };
  }

  // 5. Producto disponible
  return { disponible: true };
}
