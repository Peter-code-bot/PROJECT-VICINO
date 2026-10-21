/** Keep the stored generated map columns unwritable (migrations 20260930220000
 * and 20261020150000). Supabase's generator currently emits unknown for
 * generated PostGIS columns. All other generated schema text is preserved;
 * unexpected shapes fail closed. `ubicacion_publica` is optional until its
 * migration is applied: regenerating before that must not fail.
 */
const COLUMNAS = [
  { name: 'ubicacion_mapa', required: true },
  { name: 'ubicacion_publica', required: false },
];

export function protectGeneratedMapColumn(source) {
  const match = source.match(/      products_services: \{[\s\S]*?        Relationships: \[/);
  if (!match) throw new Error('Missing products_services table in generated types.');
  let protectedTable = match[0];
  for (const { name, required } of COLUMNAS) {
    const fields = [...protectedTable.matchAll(new RegExp(`^          ${name}\\?: (unknown|never)$`, 'gm'))];
    if (fields.length === 0 && !required) continue;
    if (fields.length !== 2) throw new Error(`Expected exactly Insert/Update for the generated map column ${name}.`);
    protectedTable = protectedTable.replace(new RegExp(`^          ${name}\\?: unknown$`, 'gm'), `          ${name}?: never`);
  }
  return source.slice(0, match.index) + protectedTable + source.slice(match.index + match[0].length);
}
