import { CATEGORIES } from "@vicino/shared";

/**
 * Primer segmento que puede abrir una ficha: /[categoria]/[slug].
 *
 * `[categoria]` es el unico segmento dinamico en la raiz de la app, asi que
 * Next lo usa para CUALQUIER ruta de dos segmentos sin pagina propia, empiece
 * por lo que empiece: tambien las que el proxy no vigila (lo que excluye su
 * matcher) y las que requiereSesion() deja abiertas por prefijo (/login/...,
 * /api/..., las legales). Si la ficha se abriera con cualquier primer segmento,
 * la exigencia de sesion de la ficha dependeria de que ninguna de esas rutas
 * casara con ella. Por eso solo una categoria real abre una ficha.
 *
 * La lista es CATEGORIES: la que valida el alta (zod) y la que casa con la
 * tabla categories, con el pivote product_categories y con la columna
 * categoria (comprobado contra produccion el 18-nov-2026: las tres suman los
 * mismos 42 slugs). Ninguna ruta publica ni tecnica es una categoria, y
 * ruta-de-ficha.test.ts vigila que toda URL de ficha pase por el proxy y exija
 * sesion.
 *
 * Modulo puro: lo importan el layout de [categoria], la pagina y su prueba.
 */
const CATEGORIAS_DE_FICHA: ReadonlySet<string> = new Set(CATEGORIES.map((categoria) => categoria.slug));

export function esCategoriaDeFicha(segmento: string): boolean {
  return CATEGORIAS_DE_FICHA.has(segmento);
}

/** Ruta canonica de la ficha con los segmentos ya validados y codificados. */
export function rutaDeFicha(categoria: string, slug: string): string {
  return `/${encodeURIComponent(categoria)}/${encodeURIComponent(slug)}`;
}
