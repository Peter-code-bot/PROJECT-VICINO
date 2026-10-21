import assert from 'node:assert/strict';
import {protectGeneratedMapColumn} from './lib/database-type-overrides.mjs';

const source = `      products_services: {
        Row: {
          ubicacion_mapa: unknown
          new_real_column: string
        }
        Insert: {
          ubicacion_mapa?: unknown
        }
        Update: {
          ubicacion_mapa?: unknown
        }
        Relationships: [
        ]
      }
      other_table: {
          ubicacion_mapa?: unknown
      }
      profile_public_name: { Args: { p_nombre: string }; Returns: string }
`;
const protectedSource = protectGeneratedMapColumn(source);
assert.equal(protectedSource, source.replace('ubicacion_mapa?: unknown', 'ubicacion_mapa?: never').replace('ubicacion_mapa?: unknown', 'ubicacion_mapa?: never'));
assert.ok(protectedSource.includes('ubicacion_mapa: unknown'));
assert.ok(protectedSource.includes('new_real_column: string'));
assert.ok(protectedSource.includes('other_table: {\n          ubicacion_mapa?: unknown'));
assert.equal(protectGeneratedMapColumn(protectedSource), protectedSource);
assert.throws(() => protectGeneratedMapColumn(source.replace('products_services', 'unexpected_table')));
assert.throws(() => protectGeneratedMapColumn(source.replace('ubicacion_mapa?: unknown', 'ubicacion_mapa?: string')));

// After migration 20261020150000 the generator also emits ubicacion_publica (S13).
const withPublica = source
  .replace('          ubicacion_mapa: unknown\n', '          ubicacion_mapa: unknown\n          ubicacion_publica: unknown\n')
  .replace(/^        (Insert|Update): \{\n          ubicacion_mapa\?: unknown\n/gm, '        $1: {\n          ubicacion_mapa?: unknown\n          ubicacion_publica?: unknown\n');
const protectedBoth = protectGeneratedMapColumn(withPublica);
assert.equal((protectedBoth.match(/ubicacion_publica\?: never/g) ?? []).length, 2);
assert.equal((protectedBoth.match(/ubicacion_mapa\?: never/g) ?? []).length, 2);
assert.ok(protectedBoth.includes('ubicacion_publica: unknown'), 'Row stays readable');
assert.equal(protectGeneratedMapColumn(protectedBoth), protectedBoth);
// Only one of Insert/Update carrying the new column is a generator shape we do not know.
assert.throws(() => protectGeneratedMapColumn(withPublica.replace('ubicacion_publica?: unknown\n', '')));
console.log('PASS generated map columns are read-only (ubicacion_mapa required, ubicacion_publica optional); new schema, RPCs and other tables preserved; idempotent; unexpected schema rejected');
