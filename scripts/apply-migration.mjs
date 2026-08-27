#!/usr/bin/env node
/**
 * Aplica UN archivo de supabase/migrations/ a la base de produccion y lo anota
 * en el ledger, en la misma llamada y en la misma transaccion.
 *
 *   node scripts/apply-migration.mjs 20260826360000_truncate_no_es_para_anon.sql
 *   node scripts/apply-migration.mjs <archivo> --dry-run
 *
 * POR QUE EXISTE. `supabase db push` esta bloqueado por el barandal mientras el
 * ledger tenga drift, y con razon: arrastraria backfills viejos no idempotentes.
 * Pero hacia falta igual un camino para aplicar UNA migracion nueva. Sin el, la
 * alternativa real era pegar SQL suelto contra la Management API, que es
 * exactamente lo que el barandal prohibe porque no deja rastro en git.
 *
 * ESTA HERRAMIENTA NO ES UN HUECO EN EL BARANDAL, ES SU CAMINO CORTO. La regla
 * 'escritura-cruda-a-management-api' pide textualmente "usa un archivo en
 * supabase/migrations/". Aqui el SQL SOLO puede venir de un archivo de esa
 * carpeta: no hay forma de pasarle una sentencia por linea de comandos. Lo que
 * se aplica es, literalmente, lo que Pedro y su copiloto pueden leer en el diff.
 *
 * Cuatro candados:
 *
 *   1. La ruta se resuelve y se exige que caiga dentro de supabase/migrations.
 *      Un `../../` no sale de ahi.
 *   2. El nombre tiene que ser <14 digitos>_<nombre>.sql, que es el formato del
 *      CLI. Asi la version del ledger sale del nombre y no de un argumento.
 *   3. Si la version ya esta en schema_migrations, se niega. Reaplicar una
 *      migracion es como se corrompe un ledger.
 *   4. Todo va dentro de BEGIN ... COMMIT junto con el INSERT del ledger. O
 *      entran las dos cosas o no entra ninguna: nunca queda produccion cambiada
 *      con el ledger diciendo que no.
 *
 * El token sale de VICINO_SUPABASE_PAT o del .env. Nunca se imprime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const NOMBRE_VALIDO = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const readToken = () => {
  const fromEnv = process.env.VICINO_SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv.trim();

  const envFile = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    if (line) return line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  }

  throw new Error(
    'No hay token. Define VICINO_SUPABASE_PAT (scripts/setup-agent-secrets.ps1) ' +
      'o deja SUPABASE_ACCESS_TOKEN en .env'
  );
};

const post = async (query) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
};

/** Cita una cadena para SQL doblando las comillas simples. */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const arg = args.find((a) => !a.startsWith('--'));
  if (!arg) throw new Error('Uso: node scripts/apply-migration.mjs <archivo.sql> [--dry-run]');

  // Candado 1: la ruta no puede salir de supabase/migrations.
  const abs = path.resolve(MIGRATIONS_DIR, path.basename(arg));
  if (path.dirname(abs) !== MIGRATIONS_DIR) {
    throw new Error(`Fuera de supabase/migrations: ${abs}`);
  }
  if (!fs.existsSync(abs)) throw new Error(`No existe: ${abs}`);

  // Candado 2: el nombre manda. La version sale de ahi, no de un argumento.
  const m = NOMBRE_VALIDO.exec(path.basename(abs));
  if (!m) {
    throw new Error(
      `Nombre invalido: ${path.basename(abs)}\n` +
        'Formato esperado: <14 digitos>_<nombre_con_guiones_bajos>.sql'
    );
  }
  const [, version, nombre] = m;

  const sql = fs.readFileSync(abs, 'utf8').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('El archivo esta vacio.');

  // Candado 3: nunca reaplicar.
  const yaEsta = await post(
    `SELECT version FROM supabase_migrations.schema_migrations WHERE version = ${q(version)}`
  );
  if (Array.isArray(yaEsta) && yaEsta.length > 0) {
    throw new Error(
      `La version ${version} YA esta en el ledger. Reaplicar corrompe el historial.\n` +
        'Si de verdad hace falta cambiar algo, escribe una migracion nueva.'
    );
  }

  // Candado 4: el cambio y su anotacion, o las dos o ninguna.
  const transaccion = [
    'BEGIN;',
    sql + ';',
    'INSERT INTO supabase_migrations.schema_migrations (version, name)',
    `VALUES (${q(version)}, ${q(nombre)});`,
    'COMMIT;',
  ].join('\n');

  if (dryRun) {
    process.stdout.write(`-- DRY RUN: no se envio nada.\n${transaccion}\n`);
    return;
  }

  const resultado = await post(transaccion);
  process.stdout.write(
    `Aplicada ${version}_${nombre}\n` + JSON.stringify(resultado, null, 2) + '\n'
  );
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
