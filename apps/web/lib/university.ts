import { UNIVERSITY_COLORS, getContrastYIQ } from "./utils";

/** A discovery filter, never a product category stored in the database. */
export const UNIVERSITY_CATEGORY = "universidad";
export const UNIVERSITY_SEARCH_URL = `/buscar?category=${UNIVERSITY_CATEGORY}`;

export function universityStyle(university: string) {
  const backgroundColor = UNIVERSITY_COLORS[university] ?? "#0ea5e9";
  return { backgroundColor, color: getContrastYIQ(backgroundColor) };
}

/**
 * "Ver todo" de una fila universitaria de Home: /buscar dentro de la
 * universidad Y de esa categoria. Sin slug (o con uno vacio o "universidad")
 * es el destino general del modo universidad.
 */
export function universitySearchUrl(slug?: string | null): string {
  const limpio = slug?.trim();
  if (!limpio || limpio === UNIVERSITY_CATEGORY) return UNIVERSITY_SEARCH_URL;
  return `${UNIVERSITY_SEARCH_URL}&subcategory=${encodeURIComponent(limpio)}`;
}
