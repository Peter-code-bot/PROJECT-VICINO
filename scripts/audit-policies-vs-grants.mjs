#!/usr/bin/env node
/**
 * Audita la desalineacion entre policies de RLS y privilegios en VICINO.
 *
 *   node scripts/audit-policies-vs-grants.mjs
 *
 * Existe porque este proyecto se ha roto CUATRO veces por el mismo motivo, y las
 * cuatro se descubrieron en runtime, tarde:
 *
 *   - modo_precio        columna nueva sin GRANT -> toda edicion moria con 42501
 *   - sort_order         migracion sin aplicar, y ademas sin GRANT
 *   - sale_confirmations policy de UPDATE desde marzo, GRANT nunca. Habria
 *                        reventado en la PRIMERA venta real
 *   - profiles           el candado de asignacion masiva se puso al UPDATE y se
 *                        olvido del INSERT
 *
 * Son dos fallos distintos y hay que mirar los dos:
 *
 *   A) POLICY SIN PRIVILEGIO. La policy dice que si, el GRANT no existe. Falla en
 *      runtime con 42501. Ruidoso, pero solo cuando alguien lo ejerce.
 *
 *   B) PRIVILEGIO SIN POLICY. El GRANT dice que si, no hay policy que permita la
 *      fila. En INSERT lanza 42501; pero en UPDATE y DELETE la ausencia de USING
 *      filtra TODAS las filas y PostgREST responde 204 sin error. Cero filas
 *      afectadas, cero señales. Es el modo de fallo mas caro que tiene este
 *      proyecto, y el que dejo el panel de moderacion mintiendo durante meses.
 *
 * Salida distinta a proposito: (A) hace fallar el script, porque es un bug seguro.
 * (B) solo se lista, porque a veces es intencional — un GRANT amplio con la
 * intencion de restringir por policy mas adelante. Pero conviene mirarlo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'oxxdkwywprkfghhbnoto';
const ROL = 'authenticated';

const token = (() => {
  const fromEnv = process.env.VICINO_SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const line = fs
    .readFileSync(path.join(REPO, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
  if (!line) throw new Error('No hay token: define VICINO_SUPABASE_PAT o SUPABASE_ACCESS_TOKEN.');
  return line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
})();

/**
 * Desalineaciones conocidas y justificadas. Cada una lleva su motivo, y el motivo
 * es parte del contrato: si alguien quita la razon, tiene que quitar la excepcion.
 *
 * No es una alfombra bajo la que barrer. Una entrada aqui significa "la policy
 * existe pero nadie la ejerce, porque esa escritura pasa por un RPC". Si el
 * codigo vuelve a escribir directo, el fallo reaparece en runtime — y por eso
 * cada excepcion nombra la funcion que hace el trabajo.
 */
const EXCEPCIONES = new Map([
  [
    'user_roles',
    'Las escrituras pasan por admin_set_user_role (SECURITY DEFINER, valida admin ' +
      'dentro de la funcion). Es deliberado no dar el GRANT: user_roles reparte ' +
      'admin, y un privilegio suelto ahi seria catastrofico el dia que la policy ' +
      'se caiga. Ver 20260826200000.',
  ],
]);

const sql = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Transaccion de solo lectura: el motor aborta cualquier escritura con 25006.
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${query};\nROLLBACK;` }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};

/**
 * Un privilegio cuenta si esta a nivel de tabla O en al menos una columna. Sin
 * mirar las dos cosas, una tabla con grants por columna (products_services,
 * profiles, sale_confirmations) sale como falso positivo.
 */
const CONSULTA_BASE = `
with pol as (
  -- cmd = 'ALL' cubre los cuatro verbos. Sin expandirlo, toda tabla cuya policy
  -- sea FOR ALL sale como si no tuviera ninguna: la primera version de este
  -- script daba 43 falsos positivos, coupons y user_blocks entre ellos, y las
  -- dos funcionan perfectamente. Un auditor con ese ruido no lo vuelve a mirar
  -- nadie.
  select tablename, verbo as cmd
  from pg_policies
  cross join lateral unnest(
    case when cmd = 'ALL' then array['INSERT','UPDATE','DELETE'] else array[cmd] end
  ) as verbo
  where schemaname = 'public' and cmd in ('ALL','INSERT','UPDATE','DELETE')
  group by 1, 2
),
priv_tabla as (
  select table_name, privilege_type from information_schema.role_table_grants
  where grantee = '${ROL}' and table_schema = 'public'
  group by 1, 2
),
priv_col as (
  select c.relname as table_name, x.privilege_type, count(*)::int as n
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace nn on nn.oid = c.relnamespace
  cross join lateral aclexplode(a.attacl) x
  where nn.nspname = 'public' and a.attacl is not null
    and x.grantee = '${ROL}'::regrole
    and x.privilege_type in ('INSERT','UPDATE','DELETE')
  group by 1, 2
)
`;

const main = async () => {
  const sinPrivilegio = await sql(`${CONSULTA_BASE}
    select pol.tablename as tabla, pol.cmd as comando
    from pol
    left join priv_tabla pt on pt.table_name = pol.tablename and pt.privilege_type = pol.cmd
    left join priv_col   pc on pc.table_name = pol.tablename and pc.privilege_type = pol.cmd
    where pt.table_name is null and pc.table_name is null
    order by 1, 2`);

  const sinPolicy = await sql(`${CONSULTA_BASE}
    select pt.table_name as tabla, pt.privilege_type as comando
    from priv_tabla pt
    join pg_class c on c.relname = pt.table_name
    join pg_namespace nn on nn.oid = c.relnamespace and nn.nspname = 'public'
    left join pol on pol.tablename = pt.table_name and pol.cmd = pt.privilege_type
    where pt.privilege_type in ('INSERT','UPDATE','DELETE')
      and pol.tablename is null
      and c.relkind = 'r' and c.relrowsecurity = true
    order by 1, 2`);

  const reales = sinPrivilegio.filter((r) => !EXCEPCIONES.has(r.tabla));
  const justificadas = sinPrivilegio.filter((r) => EXCEPCIONES.has(r.tabla));

  console.log(`\nA) POLICY SIN PRIVILEGIO — fallan con 42501 al ejercerlas`);
  if (reales.length === 0) {
    console.log('   ninguna.');
  } else {
    for (const r of reales) console.log(`   ${r.tabla} · ${r.comando}`);
  }

  if (justificadas.length > 0) {
    console.log(`\n   Conocidas y justificadas (no cuentan como fallo):`);
    for (const tabla of new Set(justificadas.map((r) => r.tabla))) {
      const verbos = justificadas.filter((r) => r.tabla === tabla).map((r) => r.comando).join(', ');
      console.log(`   · ${tabla} [${verbos}]`);
      console.log(`     ${EXCEPCIONES.get(tabla)}`);
    }
  }

  console.log(`\nB) PRIVILEGIO SIN POLICY — UPDATE y DELETE fallan EN SILENCIO (204, 0 filas)`);
  if (sinPolicy.length === 0) {
    console.log('   ninguna.');
  } else {
    for (const r of sinPolicy) console.log(`   ${r.tabla} · ${r.comando}`);
    console.log('\n   No siempre es un bug: puede ser un GRANT amplio a la espera de su policy.');
    console.log('   Pero si el codigo escribe en alguna de estas, lo hace sin enterarse de nada.');
  }

  console.log('');
  if (reales.length > 0) {
    console.error(`FALLA: ${reales.length} combinacion(es) con policy y sin privilegio.`);
    process.exit(1);
  }
  console.log('Sin policies huerfanas de privilegio.');
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
