interface RowRequest { id: string; created_at: string | null; categories: Array<{ slug: string; nombre: string }> }
/** Deterministic newest-first membership in every category, with per-row deduplication. */
export function groupRequestRows<T extends RowRequest>(requests: T[]) {
  const unique = [...new Map(requests.map(request => [request.id, request])).values()]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id));
  const categories = new Map<string, { category: { slug: string; nombre: string }; requests: T[] }>();
  for (const request of unique) {
    for (const category of new Map(request.categories.map(category => [category.slug, category])).values()) {
      const row = categories.get(category.slug) ?? { category, requests: [] };
      row.requests.push(request);
      categories.set(category.slug, row);
    }
  }
  return [{ category: null, requests: unique }, ...[...categories.values()].sort((a, b) => a.category.nombre.localeCompare(b.category.nombre, "es"))];
}
