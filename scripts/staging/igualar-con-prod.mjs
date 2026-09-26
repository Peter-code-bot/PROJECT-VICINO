#!/usr/bin/env node
/**
 * Compara el STAGING con PRODUCCION (solo lectura en prod) y, con --aplicar,
 * corrige el staging para que coincida. Cubre lo que las migraciones no
 * reproducen porque en produccion se hizo fuera de banda:
 *
 *   columnas · funciones (public, vicino_guard) · triggers · policies ·
 *   permisos de tabla y de columna para anon/authenticated
 *
 *   node scripts/staging/igualar-con-prod.mjs            # solo reporta
 *   node scripts/staging/igualar-con-prod.mjs --aplicar  # corrige staging
 *
 * Lo que llama a produccion por red (pg_net a *.supabase.co del proyecto de
 * produccion) NO se copia: el staging no debe disparar nada en produccion. Se
 * reporta para que se sepa que existe.
 */
import { readConfig, sql, prodRead, PROD_REF } from './lib.mjs';

const APPLY = process.argv.includes('--aplicar');
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

const both = async (ref, query) => {
  const [p, s] = await Promise.all([prodRead(query), sql(ref, query)]);
  return { p, s };
};

const Q = {
  columnas: `select table_name || '.' || column_name as k, data_type as t
             from information_schema.columns where table_schema = 'public'`,
  funciones: `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
                     md5(pg_get_functiondef(p.oid)) as h, pg_get_functiondef(p.oid) as def
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public','vicino_guard') and p.prokind = 'f'
                and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  triggers: `select c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) as def, c.relname as tabla, t.tgname as nombre
             from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and not t.tgisinternal`,
  policies: `select tablename || '.' || policyname as k, tablename, policyname, cmd, permissive,
                    roles::text as roles, qual, with_check
             from pg_policies where schemaname = 'public'`,
  permTabla: `select table_name || ':' || grantee || ':' || privilege_type as k, table_name, grantee, privilege_type
              from information_schema.table_privileges
              where table_schema = 'public' and grantee in ('anon','authenticated')`,
  permColumna: `select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type as k,
                       table_name, column_name, grantee, privilege_type
                from information_schema.column_privileges
                where table_schema = 'public' and grantee in ('anon','authenticated')`,
};

const index = (rows) => new Map(rows.map((r) => [r.k, r]));
const diff = (p, s) => {
  const P = index(p), S = index(s);
  return {
    soloProd: [...P.keys()].filter((k) => !S.has(k)).map((k) => P.get(k)),
    soloStaging: [...S.keys()].filter((k) => !P.has(k)).map((k) => S.get(k)),
    comun: [...P.keys()].filter((k) => S.has(k)).map((k) => [P.get(k), S.get(k)]),
  };
};
const tocaProd = (def) => def && def.includes(PROD_REF);

const policySql = (p) => {
  const roles = p.roles.replace(/[{}]/g, '').split(',').filter(Boolean).map(ident).join(', ');
  return (
    `DROP POLICY IF EXISTS ${ident(p.policyname)} ON public.${ident(p.tablename)};\n` +
    `CREATE POLICY ${ident(p.policyname)} ON public.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd}` +
    (roles ? ` TO ${roles}` : '') +
    (p.qual ? ` USING (${p.qual})` : '') +
    (p.with_check ? ` WITH CHECK (${p.with_check})` : '') +
    ';'
  );
};

const main = async () => {
  const cfg = readConfig();
  if (!cfg) throw new Error('No hay staging.');

  // Igualar DESPUES de aplicar una migracion pendiente la desharia (el 26-sep
  // devolvio los permisos que S04 cierra). Solo se corre con los ledgers iguales.
  const LEDGER = 'select version as k from supabase_migrations.schema_migrations';
  const led = await both(cfg.ref, LEDGER);
  const adelantadas = diff(led.p, led.s).soloStaging.map((r) => r.k);
  if (adelantadas.length && !process.argv.includes('--forzar')) {
    throw new Error(
      `El staging tiene migraciones que produccion no (${adelantadas.join(', ')}). ` +
        'Igualar ahora desharia su efecto. Corre esto ANTES de aplicarlas, o usa --forzar sabiendo que se pierden.'
    );
  }
  const fixes = [];
  const reporte = [];
  const log = (s) => reporte.push(s);

  // 1. Columnas: solo se reporta; una columna fuera de banda se agrega en
  //    replicar-esquema como pre-hook, con su tipo exacto.
  const col = await both(cfg.ref, Q.columnas);
  const dc = diff(col.p, col.s);
  log(`columnas solo en prod: ${dc.soloProd.map((r) => r.k).join(', ') || 'ninguna'}`);
  log(`columnas solo en staging: ${dc.soloStaging.map((r) => r.k).join(', ') || 'ninguna'}`);

  // 2. Funciones
  const fn = await both(cfg.ref, Q.funciones);
  const df = diff(fn.p, fn.s);
  const distintas = df.comun.filter(([a, b]) => a.h !== b.h);
  for (const f of [...df.soloProd, ...distintas.map(([a]) => a)]) {
    if (tocaProd(f.def)) log(`NO se copia (llama a prod): ${f.k}`);
    else fixes.push(f.def + ';');
  }
  log(`funciones solo en prod: ${df.soloProd.length} · distintas: ${distintas.length} · solo en staging: ${df.soloStaging.length}`);
  for (const f of df.soloProd) log(`  + ${f.k}`);
  for (const [a] of distintas) log(`  ~ ${a.k}`);
  for (const f of df.soloStaging) log(`  - ${f.k} (se deja: no estorba)`);

  // 3. Triggers
  const tg = await both(cfg.ref, Q.triggers);
  const dt = diff(tg.p, tg.s);
  const fnProdDefs = new Map(fn.p.map((f) => [f.k, f.def]));
  for (const t of dt.soloProd) {
    const llamaProd = [...fnProdDefs.entries()].some(([k, def]) => t.def.includes(k.split('(')[0].split('.')[1] + '(') && tocaProd(def));
    if (llamaProd) log(`NO se copia trigger (su funcion llama a prod): ${t.k}`);
    else fixes.push(`${t.def};`);
  }
  for (const t of dt.soloStaging) fixes.push(`DROP TRIGGER IF EXISTS ${ident(t.nombre)} ON public.${ident(t.tabla)};`);
  for (const [a, b] of dt.comun) if (a.def !== b.def) {
    fixes.push(`DROP TRIGGER IF EXISTS ${ident(b.nombre)} ON public.${ident(b.tabla)};`, `${a.def};`);
  }
  log(`triggers solo en prod: ${dt.soloProd.map((r) => r.k).join(', ') || 'ninguno'}`);
  log(`triggers solo en staging: ${dt.soloStaging.map((r) => r.k).join(', ') || 'ninguno'}`);

  // 4. Policies
  const po = await both(cfg.ref, Q.policies);
  const dp = diff(po.p, po.s);
  for (const p of dp.soloProd) fixes.push(policySql(p));
  for (const p of dp.soloStaging) fixes.push(`DROP POLICY IF EXISTS ${ident(p.policyname)} ON public.${ident(p.tablename)};`);
  const polDist = dp.comun.filter(([a, b]) =>
    a.cmd !== b.cmd || a.permissive !== b.permissive || a.roles !== b.roles || a.qual !== b.qual || a.with_check !== b.with_check);
  for (const [a] of polDist) fixes.push(policySql(a));
  log(`policies solo en prod: ${dp.soloProd.length} · solo en staging: ${dp.soloStaging.length} · distintas: ${polDist.length}`);
  for (const p of dp.soloStaging) log(`  - ${p.k}`);
  for (const p of dp.soloProd) log(`  + ${p.k}`);
  for (const [a] of polDist) log(`  ~ ${a.k}`);

  // 5. Permisos de tabla y de columna (anon/authenticated)
  const pt = await both(cfg.ref, Q.permTabla);
  const dpt = diff(pt.p, pt.s);
  for (const g of dpt.soloProd) fixes.push(`GRANT ${g.privilege_type} ON public.${ident(g.table_name)} TO ${g.grantee};`);
  for (const g of dpt.soloStaging) fixes.push(`REVOKE ${g.privilege_type} ON public.${ident(g.table_name)} FROM ${g.grantee};`);
  log(`permisos de tabla solo en prod: ${dpt.soloProd.length} · solo en staging: ${dpt.soloStaging.length}`);
  for (const g of dpt.soloStaging.slice(0, 30)) log(`  - ${g.k}`);

  const pc = await both(cfg.ref, Q.permColumna);
  const dpc = diff(pc.p, pc.s);
  for (const g of dpc.soloProd) fixes.push(`GRANT ${g.privilege_type} (${ident(g.column_name)}) ON public.${ident(g.table_name)} TO ${g.grantee};`);
  for (const g of dpc.soloStaging) fixes.push(`REVOKE ${g.privilege_type} (${ident(g.column_name)}) ON public.${ident(g.table_name)} FROM ${g.grantee};`);
  log(`permisos de columna solo en prod: ${dpc.soloProd.length} · solo en staging: ${dpc.soloStaging.length}`);

  // 6. Publicacion de Realtime: decide que eventos le llegan al cliente. El
  //    26-sep produccion NO publicaba sale_confirmations aunque la migracion
  //    20260517000001 la agrega; staging debe reproducir lo de produccion.
  const PUB = `select tablename as k from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`;
  const pub = await both(cfg.ref, PUB);
  const dpub = diff(pub.p, pub.s);
  for (const t of dpub.soloProd) fixes.push(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${ident(t.k)};`);
  for (const t of dpub.soloStaging) fixes.push(`ALTER PUBLICATION supabase_realtime DROP TABLE public.${ident(t.k)};`);
  log(`realtime solo en prod: ${dpub.soloProd.map((t) => t.k).join(', ') || 'ninguna'} · solo en staging: ${dpub.soloStaging.map((t) => t.k).join(', ') || 'ninguna'}`);

  console.log(reporte.join('\n'));
  console.log(`\n${fixes.length} correcciones pendientes en staging.`);

  if (APPLY && fixes.length) {
    // Funciones primero (los triggers y policies pueden depender de ellas),
    // luego el resto en el orden en que se generaron. Una por peticion, para
    // que un fallo diga exactamente cual.
    const esFuncion = (f) => /^CREATE OR REPLACE FUNCTION/i.test(f);
    const funciones = fixes.filter(esFuncion);
    const resto = fixes.filter((f) => !esFuncion(f));
    let ok = 0;
    const fallos = [];
    const uno = async (f) => {
      try { await sql(cfg.ref, f); ok++; } catch (e) { fallos.push(`${f.slice(0, 140).replace(/\s+/g, ' ')}\n    -> ${e.message.slice(0, 300)}`); }
    };
    for (const f of funciones) await uno(f);
    // El resto en lotes: cientos de GRANT/REVOKE uno por peticion chocan con el
    // limite de la API. Si un lote falla, se repite sentencia por sentencia
    // para saber cual fue.
    for (let i = 0; i < resto.length; i += 60) {
      const lote = resto.slice(i, i + 60);
      try { await sql(cfg.ref, lote.join('\n')); ok += lote.length; } catch { for (const f of lote) await uno(f); }
    }
    console.log(`Aplicadas ${ok}/${fixes.length}.`);
    if (fallos.length) console.log(`Fallaron ${fallos.length}:\n  ${fallos.join('\n  ')}`);
  }
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
