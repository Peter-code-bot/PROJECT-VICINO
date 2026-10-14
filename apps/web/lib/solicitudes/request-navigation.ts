import { CATEGORIES } from "@vicino/shared";
import { destinoSeguro } from "@/lib/auth/destino-seguro";

export function safeRequestReturn(value: unknown): string {
  const fallback = "/?feed=solicitudes";
  if (typeof value !== "string" || value.length > 2048 || destinoSeguro(value) !== value) return fallback;
  try {
    const url = new URL(value, "https://vicino.invalid");
    if (url.origin !== "https://vicino.invalid" || url.pathname !== "/" || url.searchParams.get("feed") !== "solicitudes") return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}

/** Query input only chooses a local collection; it never becomes a target URL. */
export function readRequestCollection(search: URLSearchParams) {
  if (search.get("request_collection") !== "1") return null;
  const slug = search.get("request_cat");
  const category = CATEGORIES.find(category => category.slug === slug);
  const validSlug = typeof slug === "string" && slug.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  return { category: validSlug ? { slug, nombre: category?.name ?? slug } : null };
}
export function requestCollectionURL(pathname: string, search: URLSearchParams, category: string | null, overview = false) {
  const next = new URLSearchParams(search);
  next.set("feed", "solicitudes");
  next.delete("request_collection"); next.delete("request_cat");
  if (!overview) { next.set("request_collection", "1"); if (category) next.set("request_cat", category); }
  return `${pathname}?${next}`;
}
