#!/usr/bin/env node
/**
 * Prueba de ESCRITURA contra produccion que nunca persiste.
 *
 *   node scripts/db-probe.mjs "update x set y=1 where id='...'; select ...;"
 *   node scripts/db-probe.mjs --file prueba.sql
 *
 * Por que existe: verificar que una policy, un GRANT o un RPC hacen lo que
 * dicen exige EJERCERLOS. Comprobar que la funcion existe y que el privilegio
 * esta otorgado no demuestra que la logica de dentro funcione — es justo la
 * clase de suposicion que dejo cinco tablas rotas en silencio en este proyecto.
 *
 * Por que es seguro: todo va dentro de BEGIN ... ROLLBACK. Lo unico que puede
 * hacer que algo persista es un COMMIT, y COMMIT (con su sinonimo END) esta
 * prohibido sintacticamente. No es una heuristica sobre que verbos parecen
 * peligrosos: es que no existe camino a disco.
 *
 * Limitacion conocida y deliberada: END se prohibe aunque en PL/pgSQL sea el
 * cierre de un bloque y no un COMMIT. O sea, un DO $$ ... END $$ no pasa por
 * aqui. Se prefiere ese falso rechazo, que es ruidoso e inofensivo, a la
 * alternativa de intentar distinguir los dos usos y equivocarse en el sentido
 * que si escribe a disco. Para varios casos de prueba, una invocacion por caso.
 *
 * Patron canonico para probar bajo un rol real, segun CLAUDE.md:
 *
 *   SET LOCAL ROLE authenticated;
 *   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
 *
 * Sin el SET LOCAL ROLE la consulta corre como postgres, que BRINCA la RLS, y
 * la prueba pasa por la razon equivocada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** Vacia literales y comentarios para no acusar a un COMMIT citado. */
const stripNoise = (sql) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

/**
 * COMMIT y su sinonimo END son la unica salida a disco. PREPARE TRANSACTION
 * tambien: deja la transaccion en dos fases y sobrevive a la desconexion.
 */
const ESCAPES = /\b(commit|end|prepare\s+transaction)\b/i;

const assertNoEscape = (sql) => {
  const bare = stripNoise(sql);
  const m = bare.match(ESCAPES);
  if (m) {
    throw new Error(
      `Esta herramienta revierte SIEMPRE, y "${m[0].toUpperCase()}" romperia esa garantia.\n` +
        'Si el cambio debe persistir, escribe una migracion en supabase/migrations/.'
    );
  }
  if (!bare.trim()) throw new Error('Consulta vacia.');
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
  const sql =
    fileFlag >= 0
      ? fs.readFileSync(args[fileFlag + 1], 'utf8')
      : args.filter((a) => !a.startsWith('--')).join(' ');

  assertNoEscape(sql);

  const envuelto = `BEGIN;\n${sql.trim().replace(/;?\s*$/, ';')}\nROLLBACK;`;

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: envuelto }),
  });

  const texto = await r.text();
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${texto}`);
    process.exit(1);
  }
  console.log(texto);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
