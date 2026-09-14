#!/usr/bin/env node
/**
 * Comprueba que el repo, las migraciones aplicadas y los tipos dicen lo mismo.
 *
 *   node scripts/verificar-correspondencia.mjs
 *
 * POR QUE EXISTE. Tres cosas que tienen que ir juntas se desincronizan por
 * caminos distintos y ninguna avisa sola:
 *
 *   1. supabase/migrations/ vs supabase_migrations.schema_migrations.
 *      Un archivo en el repo que nadie aplico es una funcion que el codigo
 *      llama y que en produccion no existe (PGRST202). Una fila en el ledger
 *      sin archivo es un cambio aplicado a mano del que no queda rastro en
 *      git: nadie puede revisarlo ni reproducirlo en otro proyecto.
 *
 *   2. apps/web/types/database.types.ts vs el schema real.
 *      Se genera desde produccion, asi que en cuanto se aplica una migracion
 *      queda viejo. El sintoma no es un error de compilacion — es un `as` que
 *      alguien mete para salir del paso, o una llamada tipada a una RPC que ya
 *      no tiene esa firma.
 *
 *   3. El commit desplegado.
 *      Se informa para que quien lea la salida sepa contra que codigo esta
 *      comparando.
 *
 * Sale con codigo 1 si algo no cuadra, para poder encadenarlo en CI.
 *
 * Es SOLO LECTURA: no aplica migraciones ni reescribe los tipos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function consultar(sql) {
  const salida = execFileSync('node', [path.join(RAIZ, 'scripts', 'db-query.mjs'), sql], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    cwd: RAIZ,
  });
  return JSON.parse(salida);
}

let problemas = 0;

// ---------------------------------------------------------------------------
console.log('\n== Migraciones ==');

const dirMigraciones = path.join(RAIZ, 'supabase', 'migrations');
const enRepo = fs
  .readdirSync(dirMigraciones)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .map((f) => ({ version: f.slice(0, 14), archivo: f }))
  .sort((a, b) => a.version.localeCompare(b.version));

const enLedger = consultar(
  'select version from supabase_migrations.schema_migrations order by version',
).map((r) => r.version);

const setLedger = new Set(enLedger);
const setRepo = new Set(enRepo.map((m) => m.version));

const sinAplicar = enRepo.filter((m) => !setLedger.has(m.version));
const sinArchivo = enLedger.filter((v) => !setRepo.has(v));

console.log(`   repo: ${enRepo.length}    produccion: ${enLedger.length}`);

if (sinAplicar.length) {
  problemas += 1;
  console.log(`   FALTAN POR APLICAR (${sinAplicar.length}):`);
  for (const m of sinAplicar) console.log(`      ${m.archivo}`);
  console.log('   -> node scripts/apply-migration.mjs <archivo>');
}

if (sinArchivo.length) {
  problemas += 1;
  console.log(`   APLICADAS SIN ARCHIVO EN GIT (${sinArchivo.length}):`);
  for (const v of sinArchivo) console.log(`      ${v}`);
  console.log('   -> alguien aplico SQL fuera de banda; hay que reconstruir el archivo');
}

if (!sinAplicar.length && !sinArchivo.length) {
  console.log('   OK: cuadran exactamente.');
}

// ---------------------------------------------------------------------------
console.log('\n== Tipos ==');

try {
  execFileSync('node', [path.join(RAIZ, 'scripts', 'gen-types.mjs'), '--check'], {
    encoding: 'utf8',
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('   OK: database.types.ts coincide con produccion.');
} catch {
  problemas += 1;
  console.log('   DESFASADOS: database.types.ts no coincide con el schema de produccion.');
  console.log('   -> node scripts/gen-types.mjs   (y commitear el resultado)');
}

// ---------------------------------------------------------------------------
console.log('\n== Codigo ==');

try {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: RAIZ }).trim();
  const sucio = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: RAIZ }).trim();
  console.log(`   HEAD: ${sha.slice(0, 8)}`);
  if (sucio) {
    console.log('   AVISO: hay cambios sin commitear; lo desplegado no es lo que hay aqui.');
  }
} catch {
  console.log('   (sin git)');
}

console.log(
  problemas === 0
    ? '\nTodo cuadra.\n'
    : `\n${problemas} cosa(s) fuera de sitio.\n`,
);

process.exit(problemas === 0 ? 0 : 1);
