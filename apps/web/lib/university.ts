import { UNIVERSITY_COLORS, getContrastYIQ } from "@/lib/utils";

/** A discovery filter, never a product category stored in the database. */
export const UNIVERSITY_CATEGORY = "universidad";
export const UNIVERSITY_SEARCH_URL = `/buscar?category=${UNIVERSITY_CATEGORY}`;

export function universityStyle(university: string) {
  const backgroundColor = UNIVERSITY_COLORS[university] ?? "#0ea5e9";
  return { backgroundColor, color: getContrastYIQ(backgroundColor) };
}
