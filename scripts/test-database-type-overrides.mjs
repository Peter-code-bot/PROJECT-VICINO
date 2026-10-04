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
console.log('PASS generated map column is read-only; new schema, RPCs and other tables preserved; idempotent; unexpected schema rejected');
