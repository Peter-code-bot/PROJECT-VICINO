#!/usr/bin/env node
/**
 * Suite del barandal. Corre con:  node .claude/hooks/guard-db.test.js
 *
 * Un barandal sin pruebas es una creencia. Cada caso declara lo que debe pasar,
 * y los casos ALLOW importan tanto como los DENY: un barandal con falsos
 * positivos termina apagado.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, 'guard-db.js');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const pwsh = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });
const sql = (query) => ({ tool_name: 'mcp__supabase__execute_sql', tool_input: { query } });

const CASES = [
  // --- deben bloquearse ---
  ['DENY', 'db reset', bash('npx supabase db reset')],
  ['DENY', 'drop table', sql('DROP TABLE public.products;')],
  ['DENY', 'drop function', sql('drop function search_nearby_products_v4;')],
  ['DENY', 'truncate via CLI', pwsh('npx supabase db execute "TRUNCATE messages"')],
  ['DENY', 'delete sin where', sql('delete from seller_verification;')],
  ['DENY', 'update sin where', sql('UPDATE profiles SET is_hidden = true')],
  ['DENY', 'drop column', sql('alter table products drop column sort_order')],
  ['DENY', 'echo canalizado a psql', bash('echo "drop table products" | psql $DB')],
  [
    'DENY',
    'escritura cruda a Management API',
    bash(
      'curl -X POST https://api.supabase.com/v1/projects/oxxdkwywprkfghhbnoto/database/query ' +
        '-d {"query":"alter table products add column x int"}'
    ),
  ],
  ['DENY', 'cat .env', bash('cat .env')],
  ['DENY', 'Get-Content .env.local', pwsh('Get-Content apps/web/.env.local')],

  // --- deben permitirse ---
  ['ALLOW', 'select simple', sql('select count(*) from products where is_hidden = false')],
  ['ALLOW', 'update con where', sql('update products set sort_order = 1 where id = 42')],
  ['ALLOW', 'delete con where', sql('delete from carts where user_id = 7;')],
  ['ALLOW', 'create index (no destructivo)', sql('create index idx_p on products (created_at)')],
  ['ALLOW', 'lectura de Management API', bash(
    'curl https://api.supabase.com/v1/projects/oxxdkwywprkfghhbnoto/database/query ' +
      '-d {"query":"select 1"}'
  )],
  ['ALLOW', 'cat .env.example', bash('cat .env.example')],
  ['ALLOW', 'listar nombres de .env', bash('grep -oE "^[A-Za-z_]+" .env')],
  ['ALLOW', 'build', bash('pnpm build')],
  ['ALLOW', 'echo que menciona drop table', bash('echo "no vamos a drop table nada"')],
  // Un "where" citado dentro de un literal no es una clausula: este UPDATE
  // toca la tabla entera y debe bloquearse igual que cualquier otro sin WHERE.
  ['DENY', 'where citado no cuenta como clausula', sql("update p set n = 'where x' ")],
];

const verdictFor = (event) => {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify(event),
    encoding: 'utf8',
  }).trim();
  return out ? 'DENY' : 'ALLOW';
};

let failed = 0;
let total = 0;

for (const [expected, label, event] of CASES) {
  total += 1;
  let actual;
  try {
    actual = verdictFor(event);
  } catch (error) {
    actual = `ERROR(${error.message.split('\n')[0]})`;
  }
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  FALLA'} [${actual}] esperaba ${expected} — ${label}`);
}

// ---------------------------------------------------------------------------
// `db push` es CONDICIONAL: se bloquea solo mientras el ledger tenga drift.
//
// El caso viejo afirmaba DENY a secas y empezo a fallar el dia que el ledger
// quedo reconciliado — o sea, la prueba fallaba por que la regla funcionaba.
// Una prueba que hay que ignorar es peor que no tenerla, asi que ahora se
// comprueba el contrato de verdad, moviendo el marcador y devolviendolo.
// ---------------------------------------------------------------------------
const MARCADOR = path.join(__dirname, '..', '..', 'supabase', '.ledger-reconciled');
const APARTADO = MARCADOR + '.prueba';

const escenario = (etiqueta, esperado, preparar, restaurar) => {
  let actual;
  preparar();
  try {
    actual = verdictFor(bash('npx supabase db push --linked'));
  } catch (error) {
    actual = `ERROR(${error.message.split(String.fromCharCode(10))[0]})`;
  } finally {
    // finally, no al final del try: si la comprobacion revienta, el repo NO
    // puede quedarse sin su marcador.
    restaurar();
  }
  total += 1;
  const ok = actual === esperado;
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  FALLA'} [${actual}] esperaba ${esperado} — ${etiqueta}`);
};

if (fs.existsSync(MARCADOR)) {
  escenario(
    'db push CON el ledger reconciliado',
    'ALLOW',
    () => {},
    () => {},
  );
  escenario(
    'db push SIN el marcador de ledger reconciliado',
    'DENY',
    () => fs.renameSync(MARCADOR, APARTADO),
    () => { if (fs.existsSync(APARTADO)) fs.renameSync(APARTADO, MARCADOR); },
  );
} else {
  escenario('db push sin marcador (no habia que apartar nada)', 'DENY', () => {}, () => {});
  console.log('  nota  no se pudo probar el caso ALLOW: falta supabase/.ledger-reconciled');
}

console.log(
  failed === 0
    ? `\n${total}/${total} casos pasan.`
    : `\n${failed} de ${total} casos FALLAN.`
);
process.exit(failed === 0 ? 0 : 1);
