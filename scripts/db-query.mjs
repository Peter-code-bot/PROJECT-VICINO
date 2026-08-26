#!/usr/bin/env node
/**
 * Consulta de SOLO LECTURA contra la base de produccion de VICINO.
 *
 *   node scripts/db-query.mjs "select count(*) from products_services"
 *   node scripts/db-query.mjs --file consulta.sql
 *
 * Por que existe: el agente necesita inspeccionar produccion decenas de veces
 * por sesion. Repetir curl con el token en la linea de comandos lo expondria al
 * historial de la terminal en cada consulta.
 *
 * Por que es seguro, en dos capas:
 *
 *   1. Sintactica: rechaza lo que no empiece por SELECT / WITH / EXPLAIN y lo
 *      que contenga un verbo de escritura. Falla rapido y con un mensaje claro.
 *   2. Del motor: envuelve la consulta en BEGIN READ ONLY ... ROLLBACK. Postgres
 *      rechaza entonces cualquier escritura con 25006, incluida la que ocurriria
 *      DENTRO de una funcion SECURITY DEFINER.
 *
 * La segunda capa es la que de verdad cuenta. La primera sola no basta: una
 * consulta como `select moderate_set_content_hidden(...)` pasa todos los filtros
 * de texto y escribe igual. Sin la transaccion de solo lectura, esta herramienta
 * seria un hueco alrededor del barandal de .claude/hooks/guard-db.js.
 *
 * El token sale de VICINO_SUPABASE_PAT o, si no esta, del .env del repo. Nunca
 * se imprime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** Solo estos verbos pueden iniciar una consulta. */
const READ_ONLY_START = /^(select|with|explain|show|table)\b/i;

/**
 * Verbos que jamas deben aparecer, ni siquiera despues de un WITH. Un CTE
 * puede llevar `INSERT ... RETURNING` adentro, asi que no basta con mirar
 * la primera palabra.
 */
const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|refresh|call|do)\b/i;

/** Vacia literales y comentarios para no acusar a un WHERE citado. */
const stripNoise = (sql) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

const assertReadOnly = (sql) => {
  const bare = stripNoise(sql).trim();
  if (!bare) throw new Error('Consulta vacia.');
  if (!READ_ONLY_START.test(bare)) {
    throw new Error(
      `Esta herramienta es de solo lectura. La consulta empieza con "${bare.split(/\s+/)[0]}".\n` +
        'Para cambiar schema o datos, escribe un archivo en supabase/migrations/.'
    );
  }
  const forbidden = bare.match(FORBIDDEN);
  if (forbidden) {
    throw new Error(
      `Esta herramienta es de solo lectura y la consulta contiene "${forbidden[0].toUpperCase()}".\n` +
        'Para cambiar schema o datos, escribe un archivo en supabase/migrations/.'
    );
  }
};

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

const main = async () => {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--file');
  const query =
    fileFlag !== -1 ? fs.readFileSync(args[fileFlag + 1], 'utf8') : args.join(' ');

  assertReadOnly(query);

  // La red de seguridad real. Postgres aborta con 25006 cualquier escritura que
  // se intente aqui dentro, venga de la consulta o de una funcion que llame.
  const guarded = `BEGIN READ ONLY;\n${query.trim().replace(/;\s*$/, '')};\nROLLBACK;`;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: guarded }),
  });

  const text = await response.text();
  if (!response.ok) {
    // El cuerpo del error de Supabase nombra la columna o funcion exacta;
    // perderlo es lo que vuelve caro el diagnostico.
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  process.stdout.write(JSON.stringify(JSON.parse(text), null, 2) + '\n');
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
