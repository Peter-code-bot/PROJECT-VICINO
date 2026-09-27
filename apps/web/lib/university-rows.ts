import { primaryCategorySlug } from "@vicino/shared";

/** Publicaciones por fila del modo campus (igual que las filas generales). */
export const UNIVERSITY_ROW_SIZE = 20;
/**
 * Cuantas publicaciones de la universidad se piden para armar las filas por
 * categoria. Con 20 (el tope anterior) una categoria cuyas publicaciones eran
 * mas viejas que las 20 mas nuevas salia como "No hay publicaciones" aunque
 * existieran. 150 = INITIAL_HOME_PAGE_SIZE y queda bajo el tope de 300 del RPC.
 */
export const UNIVERSITY_POOL_SIZE = 150;

type ConCategoria = { product_categories?: unknown; categoria?: string | null };

/**
 * Agrupa las publicaciones de la universidad por categoria con el MISMO
 * criterio que el catalogo general (primary del pivote, luego el TEXT, luego
 * "sin-categoria"), recorta cada fila a `tamFila` y conserva el orden de
 * entrada. `truncado` avisa que el pool llego al tope: puede haber mas
 * publicaciones de las que se ven, asi que una categoria sin fila NO prueba
 * que no existan. No muta la entrada.
 */
export function filasCampus<T extends ConCategoria>(
  products: readonly T[],
  { tamFila = UNIVERSITY_ROW_SIZE, tamPool = UNIVERSITY_POOL_SIZE }: { tamFila?: number; tamPool?: number } = {},
): { filas: [string, T[]][]; truncado: boolean } {
  const porCategoria = new Map<string, T[]>();
  for (const p of products) {
    const clave = primaryCategorySlug(p.product_categories) ?? p.categoria ?? "sin-categoria";
    const fila = porCategoria.get(clave);
    if (fila) fila.push(p);
    else porCategoria.set(clave, [p]);
  }
  const filas = [...porCategoria.entries()].map(([slug, ps]) => [slug, ps.slice(0, tamFila)] as [string, T[]]);
  return { filas, truncado: products.length >= tamPool };
}
