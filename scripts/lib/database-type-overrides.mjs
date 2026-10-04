/** Keep the stored generated map column unwritable (migration 20260930220000).
 * Supabase's generator currently emits unknown for generated PostGIS columns.
 * All other generated schema text is preserved; unexpected shapes fail closed.
 */
export function protectGeneratedMapColumn(source) {
  const match = source.match(/      products_services: \{[\s\S]*?        Relationships: \[/);
  if (!match) throw new Error('Missing products_services table in generated types.');
  const fields = [...match[0].matchAll(/^          ubicacion_mapa\?: (unknown|never)$/gm)];
  if (fields.length !== 2) throw new Error('Expected exactly Insert/Update for the generated map column.');
  const protectedTable = match[0].replace(/^          ubicacion_mapa\?: unknown$/gm, '          ubicacion_mapa?: never');
  return source.slice(0, match.index) + protectedTable + source.slice(match.index + match[0].length);
}
