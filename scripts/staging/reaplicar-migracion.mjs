#!/usr/bin/env node
/**
 * Vuelve a aplicar UNA migracion en el STAGING desde cero: ejecuta primero un
 * SQL de deshacer (archivo propio) y luego el archivo de la migracion.
 *
 *   node scripts/staging/reaplicar-migracion.mjs <version> <deshacer.sql>
 *
 * Para iterar sobre una migracion pendiente sin reconstruir el staging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, sql, REPO_ROOT } from './lib.mjs';

const [version, deshacer] = process.argv.slice(2);
if (!/^\d{14}$/.test(version ?? '') || !deshacer) {
  console.error('Uso: reaplicar-migracion.mjs <version> <deshacer.sql>');
  process.exit(2);
}
const cfg = readConfig();
const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.startsWith(`${version}_`));
if (!file) throw new Error(`No hay migracion ${version}`);

await sql(cfg.ref, fs.readFileSync(deshacer, 'utf8'));
await sql(cfg.ref, fs.readFileSync(path.join(dir, file), 'utf8'));
await sql(cfg.ref, `insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${file.slice(15, -4)}') on conflict do nothing`);
console.log(`OK: ${file} reaplicada en staging.`);
