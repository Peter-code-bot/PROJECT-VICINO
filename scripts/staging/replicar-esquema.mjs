#!/usr/bin/env node
/**
 * Reproduce `supabase/migrations` en orden sobre el STAGING. Reanudable: lleva
 * la cuenta en `.staging/aplicadas.json` y se detiene en el primer fallo con
 * el archivo y el SQLSTATE.
 *
 *   node scripts/staging/replicar-esquema.mjs [--hasta <version>]
 *
 * Ajustes SOLO para staging (los archivos del repo no se tocan):
 *  - `CREATE INDEX CONCURRENTLY` -> `CREATE INDEX`: aqui no hay carga, y
 *    CONCURRENTLY no corre en el bloque implicito de la Management API.
 *  - Antes de 20260602000001 se crean las 3 policies de `media_assets` que en
 *    produccion se hicieron desde el Dashboard (esa migracion las ALTERa). Si
 *    produccion aun las tiene se copian tal cual; si ya no, van marcadores
 *    cerrados que `igualar-con-prod.mjs` retira.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, sql, prodRead, REPO_ROOT, CONFIG_DIR, PROD_REF } from './lib.mjs';

const MIG_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const STATE = path.join(CONFIG_DIR, 'aplicadas.json');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

const LEGACY_MEDIA = [
  ['Owner delete media', 'DELETE'],
  ['Owner insert media', 'INSERT'],
  ['Owner update media', 'UPDATE'],
];

// Produccion ya las borro; la migracion solo necesita que existan para
// ALTERarlas. Marcadores cerrados (false): igualar-con-prod las quita despues.
const placeholder = ([name, cmd]) =>
  `DROP POLICY IF EXISTS ${ident(name)} ON public.media_assets;\n` +
  `CREATE POLICY ${ident(name)} ON public.media_assets FOR ${cmd} TO authenticated ` +
  (cmd === 'INSERT' ? 'WITH CHECK (false);' : 'USING (false);');

const policiesLegacyMedia = async () => {
  const rows = await prodRead(`
    select policyname, cmd, permissive, roles::text as roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'media_assets'
      and policyname in ('Owner delete media','Owner insert media','Owner update media')`);
  if (rows.length === 0) return LEGACY_MEDIA.map(placeholder).join('\n');
  return rows
    .map((p) => {
      const roles = p.roles.replace(/[{}]/g, '').split(',').filter(Boolean).map(ident).join(', ');
      return (
        `DROP POLICY IF EXISTS ${ident(p.policyname)} ON public.media_assets;\n` +
        `CREATE POLICY ${ident(p.policyname)} ON public.media_assets AS ${p.permissive} FOR ${p.cmd}` +
        (roles ? ` TO ${roles}` : '') +
        (p.qual ? ` USING (${p.qual})` : '') +
        (p.with_check ? ` WITH CHECK (${p.with_check})` : '') +
        ';'
      );
    })
    .join('\n');
};

const PRE_HOOKS = {
  '20260602000001': policiesLegacyMedia,
  // Cambia columnas OUT sin DROP previo; en produccion se aplico a mano.
  '20260819000001': async () =>
    'DROP FUNCTION IF EXISTS public.search_nearby_products_v4(double precision, double precision, integer, text, uuid[], timestamp with time zone, uuid, integer, boolean, boolean);',
  // Columna creada fuera de banda en produccion (text, nullable, sin default).
  '20260913140000': async () =>
    'ALTER TABLE public.products_services ADD COLUMN IF NOT EXISTS estado text;',
};

const main = async () => {
  const cfg = readConfig();
  if (!cfg) throw new Error('No hay staging. Corre primero scripts/staging/crear.mjs');
  const hastaIdx = process.argv.indexOf('--hasta');
  const hasta = hastaIdx === -1 ? null : process.argv[hastaIdx + 1];

  const done = new Set(fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : []);
  const files = fs.readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

  let applied = 0;
  for (const file of files) {
    const version = file.slice(0, 14);
    if (hasta && version > hasta) break;
    if (done.has(file)) continue;

    if (PRE_HOOKS[version]) {
      const pre = await PRE_HOOKS[version]();
      if (pre) await sql(cfg.ref, pre);
    }

    const body = fs
      .readFileSync(path.join(MIG_DIR, file), 'utf8')
      .replace(/create\s+index\s+concurrently/gi, 'CREATE INDEX');
    try {
      await sql(cfg.ref, body);
    } catch (e) {
      console.error(`FALLO en ${file}\n${e.message}`);
      process.exit(1);
    }
    // Un cron.schedule de produccion trae la URL de las funciones de
    // PRODUCCION: desde el staging dispararia trabajos alla. Se desprograma
    // en cuanto se crea (el 26-sep dos alcanzaron a salir y prod los rechazo
    // con 401 por no traer credencial).
    if (/cron\.schedule/i.test(body)) {
      await sql(
        cfg.ref,
        `select cron.unschedule(jobid) from cron.job where position(${q(PROD_REF)} in command) > 0`
      );
    }
    // Ledger del staging, para que se parezca al de produccion.
    await sql(
      cfg.ref,
      `insert into supabase_migrations.schema_migrations(version, name) values (${q(version)}, ${q(file.slice(15, -4))}) on conflict do nothing`
    ).catch(() => {});
    done.add(file);
    fs.writeFileSync(STATE, JSON.stringify([...done], null, 1));
    applied++;
    if (applied % 20 === 0) console.log(`  ${applied} aplicadas (ultima ${file})`);
  }
  console.log(`OK: ${applied} migraciones aplicadas en esta corrida; ${done.size} en total.`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
