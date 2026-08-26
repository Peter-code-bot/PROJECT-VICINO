#!/usr/bin/env node
/**
 * Barandal de produccion para VICINO.
 *
 * Corre como hook PreToolUse. Lee el evento en stdin, decide, y escribe la
 * decision en stdout. Solo bloquea: nunca modifica, ejecuta ni registra nada.
 *
 * Diseno: una lista de reglas puras { name, test, reason }. Agregar una regla
 * es agregar un objeto al array; la maquinaria no se toca.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Mientras este archivo no exista, `supabase db push` queda bloqueado.
 * Lo crea la reconciliacion del ledger, no una persona con prisa.
 */
const RECONCILED_FLAG = path.join(REPO_ROOT, 'supabase', '.ledger-reconciled');

const DML_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/;

/** Binarios capaces de hablarle a la base. Si aparece uno, el texto no es inerte. */
const EXECUTES_SQL = /\b(psql|supabase|curl|wget|Invoke-WebRequest|Invoke-RestMethod|pg_dump|pgcli)\b|api\.supabase\.com/i;

const ledgerIsReconciled = () => fs.existsSync(RECONCILED_FLAG);

/** Junta todo el texto inspeccionable del tool call, sin asumir su forma. */
const extractPayload = (event) => {
  const input = event.tool_input || {};
  return [input.command, input.query, input.sql, input.body, input.migration_sql]
    .filter((part) => typeof part === 'string')
    .join('\n');
};

/**
 * Normaliza SQL para que la deteccion mire estructura y no contenido: quita
 * comentarios y vacia los literales de cadena, para que un WHERE citado dentro
 * de un string no cuente como clausula real.
 */
const normalizeSql = (text) =>
  text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * Un comando que solo imprime texto no puede tocar la base, por mas que el
 * texto mencione DROP. Sin esta salida, `echo "no borres la tabla"` se bloquea
 * — y un barandal con falsos positivos es un barandal que alguien va a apagar.
 */
const isInertText = (raw) => {
  const trimmed = raw.trim();
  if (!/^(echo|printf|Write-Host|Write-Output|#|\/\/)/i.test(trimmed)) return false;
  return !EXECUTES_SQL.test(trimmed);
};

const RULES = [
  {
    name: 'db-push-bloqueado-por-drift',
    test: (raw) => /supabase\s+(?:\S+\s+)*db\s+push/.test(raw) && !ledgerIsReconciled(),
    reason:
      'BLOQUEADO: "supabase db push" contra produccion. El ledger de migraciones ' +
      'todavia tiene drift: 7 archivos del repo no estan aplicados en prod y 2 ' +
      'versiones viven en prod sin archivo. Un push intentaria correr backfills no ' +
      'idempotentes. Reconcilia primero y crea supabase/.ledger-reconciled para ' +
      'levantar este bloqueo.',
  },
  {
    name: 'db-reset-contra-prod',
    test: (raw) => /supabase\s+(?:\S+\s+)*db\s+reset/.test(raw),
    reason:
      'BLOQUEADO: "supabase db reset" destruye la base. No se corre contra el ' +
      'proyecto linkeado. Si la intencion era resetear una rama, usa --branch ' +
      'explicito y confirmalo con Pedro.',
  },
  {
    name: 'ddl-destructivo',
    test: (_raw, sql) =>
      /\bdrop\s+(table|schema|database|type|function|policy|trigger|extension)\b/.test(sql) ||
      /\btruncate\b/.test(sql) ||
      /\balter\s+table\s+[\w."]+\s+drop\s+column\b/.test(sql),
    reason:
      'BLOQUEADO: DDL destructivo (DROP / TRUNCATE / DROP COLUMN). Si el fix de ' +
      'verdad requiere borrar un objeto, escribelo como archivo de migracion, ' +
      'explica el impacto, y que Pedro lo apruebe explicitamente.',
  },
  {
    name: 'dml-sin-where',
    test: (_raw, sql) =>
      /\bdelete\s+from\s+[\w."]+\s*(;|$)/.test(sql) ||
      /\bupdate\s+[\w."]+\s+set\b(?![\s\S]*\bwhere\b)/.test(sql),
    reason:
      'BLOQUEADO: DELETE o UPDATE sin clausula WHERE. Afectaria la tabla entera. ' +
      'Agrega el WHERE, o si el cambio masivo es intencional, hazlo como migracion ' +
      'revisable.',
  },
  {
    name: 'escritura-cruda-a-management-api',
    test: (raw, sql) =>
      raw.includes('api.supabase.com') &&
      raw.includes(PROJECT_REF) &&
      raw.includes('database/query') &&
      DML_KEYWORDS.test(sql),
    reason:
      'BLOQUEADO: escritura cruda a la Management API contra produccion. Ese camino ' +
      'no deja rastro en git, que es justo lo que Pedro y su copiloto necesitan ' +
      'revisar. Usa un archivo en supabase/migrations/.',
  },
  {
    name: 'lectura-de-secretos',
    test: (raw) =>
      /\b(cat|type|less|more|head|tail|Get-Content|gc)\b[^\n|;]*\.env\b/i.test(raw) &&
      !/\.env\.example/i.test(raw),
    reason:
      'BLOQUEADO: leer un .env volcaria secretos al transcript, al contexto y a los ' +
      'logs de hooks. Si necesitas saber que variables existen, lista solo los ' +
      'nombres:  grep -oE "^[A-Za-z_]+" .env',
  },
];

const main = () => {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return null; // Un evento ilegible no es motivo para frenar el trabajo.
  }

  const raw = extractPayload(event);
  if (!raw.trim()) return null;

  const isShell = event.tool_name === 'Bash' || event.tool_name === 'PowerShell';
  if (isShell && isInertText(raw)) return null;

  const sql = normalizeSql(raw);
  const hit = RULES.find((rule) => {
    try {
      return rule.test(raw, sql);
    } catch {
      return false; // Una regla rota no debe volverse un bloqueo silencioso.
    }
  });

  return hit ? `[guard-db:${hit.name}] ${hit.reason}` : null;
};

const reason = main();
if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
}
process.exit(0);
