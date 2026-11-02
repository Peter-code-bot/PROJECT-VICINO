#!/usr/bin/env node
/**
 * Respaldo de SOLO LECTURA de todo lo que cambian las migraciones
 * 20261102120000 a 20261102120400 (cuentas internas, ventas de prueba, semilla
 * en la cuenta de Javier) y el SQL que lo devuelve. Se corre JUSTO ANTES de
 * aplicarlas en produccion.
 *
 *   node scripts/respaldo-cuentas-internas.mjs                 # produccion
 *   node scripts/respaldo-cuentas-internas.mjs --staging       # el staging
 *   node scripts/respaldo-cuentas-internas.mjs --solo-conteos  # sin archivos
 *
 * Escribe en .respaldos/<fecha>/ (fuera de git: son datos reales):
 *   respaldo.json  las filas y los valores como estaban
 *   restaurar.sql  los devuelve, incluidas las filas de seller_rankings
 *   conteos.json   las cifras de antes; --solo-conteos despues de aplicar da
 *                  las de despues con el mismo criterio
 *
 * Las cuentas internas se calculan con LOS MISMOS criterios que la semilla de
 * 20261102120000 y no con la tabla, que antes de aplicar no existe. Si cambian
 * alla, cambian aqui. Nada de aqui escribe en la base: cada consulta va dentro
 * de BEGIN READ ONLY ... ROLLBACK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prodRead, readConfig, sql, REPO_ROOT } from './staging/lib.mjs';

const ARGS = process.argv.slice(2);
const EN_STAGING = ARGS.includes('--staging');
const SOLO_CONTEOS = ARGS.includes('--solo-conteos');

const JAVIER = '7db68a49-2aa9-443a-a99c-3b654a43ec95';
const SEMILLA_JAVIER = [
  '0cde809a-292d-4fbf-9eff-f16c9a71321d', '1f3d8c62-4728-4ae4-9dd6-6883583d99f5',
  '36e7ddfa-94e4-4f22-9e85-cba2ac95cb58', '3e4d3bb7-84f2-430a-b3ac-675bdbb4e5f0',
  '6560186f-40a8-4c14-b45a-13301b83b903', '85949c48-44c5-4e70-8543-d90b7d0833c3',
  '91675669-bd70-4fc0-b1a5-022d339d64ef', 'eb9a4a40-0ac2-4737-81f6-81fc5fb7bf0e',
];
const lista = (ids) => ids.map((id) => `'${id}'`).join(', ');

/** Debe coincidir con la semilla de supabase/migrations/20261102120000_cuentas_internas.sql. */
const CTE = `
internas AS (
  SELECT u.id,
         (u.email ILIKE '%@mock-appstore.vicino.mx' OR u.email ILIKE '%@demo.vicino.mx') AS sintetica
    FROM auth.users u
   WHERE u.email ILIKE '%@mock-appstore.vicino.mx'
      OR u.email ILIKE '%@demo.vicino.mx'
      OR u.email ILIKE 'test\\_diag\\_%@example.com'
      OR u.email ILIKE 'vicino.qa%'
      OR lower(u.email) IN ('reviewconsolevicino@gmail.com', 'admin@vicinomarket.com')
      OR u.id IN ('${JAVIER}', '24ab61a7-4460-4980-a7c5-c7d4f7c93731',
                  'f0e59346-d67b-428b-a2fa-d625deb20986', '6289585b-9887-4898-b353-00c9691ddc5a')
),
de_prueba AS (
  SELECT s.* FROM public.sale_confirmations s
   WHERE s.seller_id IN (SELECT id FROM internas) OR s.buyer_id IN (SELECT id FROM internas)
),
afectadas AS (
  SELECT id FROM internas UNION SELECT seller_id FROM de_prueba UNION SELECT buyer_id FROM de_prueba
)`;

const CONSULTAS = {
  perfiles: `WITH ${CTE}
    SELECT p.id, p.username, p.is_hidden, p.trust_points, p.total_sales, p.trust_level::text AS trust_level,
           p.average_rating, p.reviews_count, p.average_rating_as_seller, p.reviews_count_as_seller,
           p.average_rating_as_buyer, p.reviews_count_as_buyer, (i.id IS NOT NULL) AS interna,
           COALESCE(i.sintetica, false) AS sintetica
      FROM public.profiles p JOIN afectadas a ON a.id = p.id LEFT JOIN internas i ON i.id = p.id
     ORDER BY p.id`,
  publicaciones: `WITH ${CTE}
    SELECT ps.id, ps.creador_id, ps.estatus::text AS estatus, ps.is_hidden, ps.ventas_count
      FROM public.products_services ps
     WHERE ps.creador_id IN (SELECT id FROM internas)
        OR ps.id IN (SELECT product_id FROM de_prueba)
        OR ps.id IN (${lista(SEMILLA_JAVIER)})
     ORDER BY ps.id`,
  comunidades: `SELECT c.id, c.nombre, c.owner_id, c.is_hidden FROM public.communities c ORDER BY c.id`,
  resenas: `WITH ${CTE}
    SELECT r.id, r.is_hidden, r.visible FROM public.reviews r
     WHERE r.sale_confirmation_id IN (SELECT id FROM de_prueba)
        OR r.reviewer_id IN (SELECT id FROM internas)
     ORDER BY r.id`,
  rankings: `SELECT sr.id, sr.seller_id, sr.category_id, sr.period, sr.composite_score, sr.ventas_count,
                    sr.ingresos, sr.rating_avg, sr.response_avg_minutes, sr.trust_points_snapshot,
                    sr.is_frozen, sr.computed_at
               FROM public.seller_rankings sr ORDER BY sr.period, sr.category_id, sr.seller_id`,
  ventas_de_prueba: `WITH ${CTE}
    SELECT d.id, d.status::text AS status, d.seller_id, d.buyer_id, d.product_id, d.precio_acordado, d.cantidad,
           d.created_at, d.completed_at,
           (d.created_at < (SELECT u.created_at FROM auth.users u WHERE u.id = d.buyer_id)) AS anterior_al_comprador
      FROM de_prueba d ORDER BY d.created_at`,
};

const CONTEOS = `WITH ${CTE},
visibles AS (
  SELECT ps.id, ps.creador_id FROM public.products_services ps
    JOIN public.profiles p ON p.id = ps.creador_id
   WHERE ps.estatus = 'disponible' AND NOT ps.is_hidden AND NOT p.is_hidden
)
SELECT
  (SELECT count(*) FROM visibles)::int AS publicaciones_visibles,
  (SELECT count(*) FROM visibles v JOIN internas i ON i.id = v.creador_id AND i.sintetica)::int AS publicaciones_visibles_sinteticas,
  (SELECT count(*) FROM visibles v WHERE v.id IN (${lista(SEMILLA_JAVIER)}))::int AS publicaciones_visibles_semilla_javier,
  (SELECT count(*) FROM visibles v WHERE v.creador_id NOT IN (SELECT id FROM internas))::int AS publicaciones_visibles_externas,
  (SELECT count(DISTINCT v.creador_id) FROM visibles v)::int AS vendedores_visibles,
  (SELECT count(*) FROM public.profiles p JOIN internas i ON i.id = p.id AND i.sintetica WHERE NOT p.is_hidden)::int AS perfiles_sinteticos_visibles,
  (SELECT count(*) FROM public.communities c WHERE NOT c.is_hidden AND c.archived_at IS NULL)::int AS comunidades_visibles,
  (SELECT count(*) FROM public.community_members m JOIN public.communities c ON c.id = m.community_id
    WHERE m.left_at IS NULL AND NOT c.is_hidden AND m.user_id IN (SELECT id FROM internas WHERE sintetica))::int AS membresias_sinteticas_en_comunidades_visibles,
  (SELECT count(*) FROM public.purchase_requests r JOIN public.profiles p ON p.id = r.buyer_id
    WHERE r.status = 'open' AND r.expires_at > now() AND NOT p.is_hidden)::int AS solicitudes_abiertas_visibles,
  (SELECT count(*) FROM public.sale_confirmations s WHERE s.status = 'completed')::int AS ventas_completadas,
  (SELECT count(*) FROM de_prueba d WHERE d.status = 'completed')::int AS ventas_completadas_de_prueba,
  (SELECT count(*) FROM public.reviews r WHERE r.sale_confirmation_id IN (SELECT id FROM de_prueba) AND NOT r.is_hidden)::int AS resenas_visibles_de_ventas_de_prueba,
  (SELECT count(*) FROM public.seller_rankings)::int AS filas_de_ranking,
  (SELECT count(*) FROM public.seller_rankings sr WHERE sr.seller_id IN (SELECT id FROM internas))::int AS filas_de_ranking_internas,
  (SELECT COALESCE(sum(p.trust_points), 0) FROM public.profiles p WHERE p.id IN (SELECT id FROM afectadas))::int AS puntos_de_cuentas_afectadas,
  (SELECT COALESCE(sum(p.total_sales), 0) FROM public.profiles p WHERE p.id IN (SELECT id FROM afectadas))::int AS ventas_en_perfiles_afectados,
  (SELECT jsonb_build_object('trust_points', p.trust_points, 'total_sales', p.total_sales,
          'trust_level', p.trust_level, 'reviews_count', p.reviews_count)
     FROM public.profiles p WHERE p.id = '${JAVIER}') AS cuenta_principal_de_javier`;

const leer = async (consulta) => {
  if (!EN_STAGING) return prodRead(consulta);
  const cfg = readConfig();
  if (!cfg) throw new Error('No hay staging (.staging/staging.json).');
  return sql(cfg.ref, `BEGIN READ ONLY;\n${consulta.trim().replace(/;\s*$/, '')};\nROLLBACK;`);
};

/** Literal SQL para un valor que vino de la base como JSON. */
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

/**
 * Deshace SOLO lo que hicieron las migraciones, sin pisar lo que haya pasado
 * despues: desoculta unicamente lo que ellas ocultaron (y solo si sigue oculto),
 * devuelve contadores sin bajar ninguno y repone las filas de ranking borradas
 * sin tocar las que se hayan recalculado.
 */
const restaurarSql = (r) => {
  const VECINOS_TABASCO = '24278f23-1e68-447a-b0e9-0df9dae01960';
  const sinteticas = new Set(r.perfiles.filter((p) => p.sintetica).map((p) => p.id));
  const semilla = new Set(SEMILLA_JAVIER);
  const lineas = [
    '-- Generado por scripts/respaldo-cuentas-internas.mjs. Deshace lo que hicieron',
    '-- 20261102120000..120400. Correr DESPUES de revertir las migraciones',
    '-- (docs/rollback/), de la ultima a la primera. Primero las resenas: sus',
    '-- disparadores recalculan calificaciones, y los valores de perfil van despues.',
    'begin;',
    "SET LOCAL lock_timeout = '5s';",
  ];
  for (const x of r.resenas.filter((x) => !x.is_hidden)) {
    lineas.push(`UPDATE public.reviews SET is_hidden = false, visible = true WHERE id = ${lit(x.id)} AND is_hidden;`);
  }
  // Sin el disparador de nivel: devolver puntos "subiria" de nivel y mandaria
  // la notificacion de subida. El nivel vuelve tal cual estaba, salvo que los
  // puntos de ahora ya superen los del respaldo (entonces se queda el actual).
  // En un UPDATE, cada expresion del SET ve los valores de ANTES.
  lineas.push('ALTER TABLE public.profiles DISABLE TRIGGER auto_update_trust_level;');
  for (const p of r.perfiles) {
    const par = (avg, n) =>
      `${avg} = CASE WHEN ${n} < ${lit(p[n])} THEN ${lit(p[avg])} ELSE ${avg} END, ${n} = GREATEST(${n}, ${lit(p[n])})`;
    lineas.push(
      `UPDATE public.profiles SET trust_points = GREATEST(trust_points, ${lit(p.trust_points)}), ` +
        `trust_level = CASE WHEN trust_points <= ${lit(p.trust_points)} THEN ${lit(p.trust_level)}::public.trust_level ELSE trust_level END, ` +
        `total_sales = GREATEST(total_sales, ${lit(p.total_sales)}), ` +
        [par('average_rating', 'reviews_count'), par('average_rating_as_seller', 'reviews_count_as_seller'),
          par('average_rating_as_buyer', 'reviews_count_as_buyer')].join(', ') +
        ` WHERE id = ${lit(p.id)};`
    );
    if (sinteticas.has(p.id) && !p.is_hidden) {
      lineas.push(`UPDATE public.profiles SET is_hidden = false WHERE id = ${lit(p.id)} AND is_hidden;`);
    }
  }
  lineas.push('ALTER TABLE public.profiles ENABLE TRIGGER auto_update_trust_level;');
  for (const x of r.publicaciones) {
    lineas.push(`UPDATE public.products_services SET ventas_count = GREATEST(ventas_count, ${lit(x.ventas_count)}) WHERE id = ${lit(x.id)};`);
    if (semilla.has(x.id) && !x.is_hidden) {
      lineas.push(`UPDATE public.products_services SET is_hidden = false WHERE id = ${lit(x.id)} AND is_hidden;`);
    }
  }
  for (const c of r.comunidades.filter((c) => !c.is_hidden && (sinteticas.has(c.owner_id) || c.id === VECINOS_TABASCO))) {
    lineas.push(`UPDATE public.communities SET is_hidden = false WHERE id = ${lit(c.id)} AND is_hidden;`);
  }
  for (const k of r.rankings.filter((x) => !x.is_frozen)) {
    lineas.push(
      'INSERT INTO public.seller_rankings (id, seller_id, category_id, period, composite_score, ventas_count, ingresos, ' +
        'rating_avg, response_avg_minutes, trust_points_snapshot, is_frozen, computed_at) VALUES (' +
        [k.id, k.seller_id, k.category_id, k.period, k.composite_score, k.ventas_count, k.ingresos, k.rating_avg,
          k.response_avg_minutes, k.trust_points_snapshot, k.is_frozen, k.computed_at].map(lit).join(', ') +
        ') ON CONFLICT (seller_id, category_id, period) DO NOTHING;'
    );
  }
  lineas.push('commit;', '');
  return lineas.join('\n');
};

const main = async () => {
  const [conteos] = await leer(CONTEOS);
  if (SOLO_CONTEOS) {
    console.log(JSON.stringify(conteos, null, 2));
    return;
  }
  const respaldo = { origen: EN_STAGING ? 'staging' : 'produccion', tomado_en: new Date().toISOString() };
  for (const [nombre, consulta] of Object.entries(CONSULTAS)) respaldo[nombre] = await leer(consulta);

  const sello = respaldo.tomado_en.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const dir = path.join(REPO_ROOT, '.respaldos', `${sello}-${respaldo.origen}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'respaldo.json'), JSON.stringify(respaldo, null, 1));
  fs.writeFileSync(path.join(dir, 'restaurar.sql'), restaurarSql(respaldo));
  fs.writeFileSync(path.join(dir, 'conteos.json'), JSON.stringify(conteos, null, 2));

  const resumen = Object.fromEntries(
    Object.entries(respaldo).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])
  );
  console.log(`Respaldo de ${respaldo.origen} en ${path.relative(REPO_ROOT, dir)}`);
  console.log(`  filas: ${JSON.stringify(resumen)}`);
  console.log(`  conteos: ${JSON.stringify(conteos)}`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
