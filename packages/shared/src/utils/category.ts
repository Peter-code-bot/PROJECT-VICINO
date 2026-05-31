import type { ProductCardCategory } from "../types/category";

// MP#08 #5c-4: helper que normaliza el embed PostgREST
//   product_categories(is_primary, categories(slug, nombre))
// a un array ProductCardCategory[] ordenado primary-first.
//
// Por que existe:
//   1. PostgREST embed orderings sobre joined tables tienen quirks
//      documentados (mismo motivo por el que 5c-3 D6 firmo 2 queries +
//      merge cliente en /buscar). Sortear primary-first client-side
//      garantiza el orden visual en cada caller sin depender de la
//      ruta postgres.
//   2. supabase-js infiere el nested embed como
//        { categories: T | T[] | null }
//      (cardinality detection es heuristica). El helper acepta unknown
//      y narrow por type predicates -- sin `any` -- para no romper en
//      runtime si la inferencia varia entre callers.
//   3. Filtra filas malformadas (categorias nulled por RLS, fields
//      missing) silenciosamente: el render NO debe crashear por embed
//      sucio, simplemente se omite la entrada problematica.
//
// Used by: ProductCard via the new optional `categories` prop, plus the
// 4 surfaces wired in 5c-4 (buscar, favoritos, home Recientes + per-cat).
// SortableProductCard (perfil/vendedor) llama esta helper igual para que
// la data quede tipada, aunque el render visual se diferira a 5c-4-bis.

function isValidEmbedCategory(
  cat: unknown,
): cat is { slug: string; nombre: string } {
  return (
    cat !== null &&
    typeof cat === "object" &&
    typeof (cat as Record<string, unknown>).slug === "string" &&
    typeof (cat as Record<string, unknown>).nombre === "string"
  );
}

export function normalizeCardCategories(
  embed: unknown,
): ProductCardCategory[] {
  if (!Array.isArray(embed)) return [];

  const rows = embed.filter(
    (r): r is { is_primary: boolean; categories: unknown } =>
      r !== null &&
      typeof r === "object" &&
      typeof (r as Record<string, unknown>).is_primary === "boolean",
  );

  const valid: ProductCardCategory[] = rows
    .filter((r) => isValidEmbedCategory(r.categories))
    .map((r) => {
      const cat = r.categories as { slug: string; nombre: string };
      return { slug: cat.slug, nombre: cat.nombre, is_primary: r.is_primary };
    });

  // Primary first, secondaries in insertion order within each tier.
  return [
    ...valid.filter((v) => v.is_primary),
    ...valid.filter((v) => !v.is_primary),
  ];
}

// MP#08 #4 Fase 1A: helpers que extraen la primary del pivote para readers
// de render y route. Reusan normalizeCardCategories (sort primary-first ya
// resuelto) y retornan null cuando no hay primary (pivote vacio o solo
// secondaries, edge cases que cada caller maneja con fallback graceful).
//
// Separacion intencional (D-A firmado):
//   - primaryCategorySlug: para builders de href que solo necesitan el slug
//     (URL `/[slug]/[product-slug]`).
//   - primaryCategoryFull: para readers de display que necesitan ademas el
//     nombre legible (breadcrumb, MetaRow, label de carrusel).
// Ambos derivan del mismo array ordenado; usar el especifico clarifica
// intencion en el call site.

export function primaryCategorySlug(embed: unknown): string | null {
  const sorted = normalizeCardCategories(embed);
  // sorted[0] es la primary cuando existe (primary-first guarantee).
  // Si no hay primary (pivote vacio o solo secondaries) retornamos null.
  return sorted[0]?.is_primary ? sorted[0].slug : null;
}

export function primaryCategoryFull(
  embed: unknown,
): { slug: string; nombre: string } | null {
  const sorted = normalizeCardCategories(embed);
  if (!sorted[0]?.is_primary) return null;
  return { slug: sorted[0].slug, nombre: sorted[0].nombre };
}
