export interface PublicProfileIdentity {
  nombre: string | null;
  es_vendedor: boolean | null;
  seller_type: string | null;
  nombre_negocio: string | null;
}

/** The visible account identity; the stored personal name remains untouched. */
export function publicProfileName(value: unknown, fallback = "Usuario"): string {
  const profile = Array.isArray(value) ? value[0] : value;
  if (!profile || typeof profile !== "object") return fallback;
  const identity = profile as Record<string, unknown>;
  if (identity.es_vendedor === true && identity.seller_type === "business") {
    const business = typeof identity.nombre_negocio === "string" ? identity.nombre_negocio.trim() : "";
    return business || "Tienda";
  }
  const personal = typeof identity.nombre === "string" ? identity.nombre.trim() : "";
  return personal || fallback;
}

/** PostgREST OR filter for the same visible identity. The caller supplies an ILIKE pattern. */
export function publicProfileSearchFilter(pattern: string): string {
  // PostgREST quoted values escape both quotes and backslashes; Supabase encodes the URL.
  const quoted = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `and(es_vendedor.eq.true,seller_type.eq.business,nombre_negocio.ilike.${quoted}),and(or(es_vendedor.is.null,es_vendedor.eq.false,seller_type.is.null,seller_type.neq.business),nombre.ilike.${quoted})`;
}
