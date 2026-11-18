#!/usr/bin/env node
/**
 * Cuentas internas (migraciones 20261102120000..120400) contra el STAGING, de
 * punta a punta, con PostgREST real.
 *
 *   node scripts/staging/probar-cuentas-internas.mjs [--conservar]
 *   node scripts/staging/probar-cuentas-internas.mjs --solo-limpiar
 *
 * Reproduce en pequeno lo que habia en produccion el 1-nov-2026:
 *   - un vendedor sintetico (@mock-appstore.vicino.mx) con reputacion sembrada,
 *     publicacion, solicitud abierta, comunidad propia y fila de ranking; un
 *     comprador demo (@demo.vicino.mx);
 *   - la cuenta principal de Javier (MISMO UUID que en produccion, correo de
 *     staging) con dos publicaciones de la semilla (mismos ids), una propia,
 *     Vecinos Tabasco 2000 (mismo id), una venta sembrada a la cuenta demo y dos
 *     ventas de prueba (a su segunda cuenta y a una externa), con resenas;
 *   - una cuenta de QA y tres externas: E1 vende, E2 compra y chatea, E3 compro
 *     en una prueba.
 * Comprueba cada superficie como anon y con sesion ANTES (que el problema se
 * ve) y DESPUES de aplicar; ensaya la reversion (docs/rollback + restaurar.sql
 * del respaldo) y vuelve a aplicar; y prueba que las funciones nuevas no
 * vuelvan a inflar nada. Retira los fixtures al final salvo con --conservar.
 * Las migraciones quedan aplicadas en el staging. Sale con 1 si algo falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { staging, http, rpc, crearUsuario } from './fixtures.mjs';
import { sql, REPO_ROOT } from './lib.mjs';

const cfg = staging();
const CONSERVAR = process.argv.includes('--conservar');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const hex = () => crypto.randomBytes(4).toString('hex');

const MIGRACIONES = [
  '20261102120000_cuentas_internas',
  '20261102120100_neutralizar_ventas_de_prueba',
  '20261102120200_semilla_villahermosa_en_cuenta_de_javier',
  '20261102120300_actividad_diaria',
  '20261102120400_metricas_externas',
];
const JAVIER = '7db68a49-2aa9-443a-a99c-3b654a43ec95';
const JAVIER_2 = '24ab61a7-4460-4980-a7c5-c7d4f7c93731';
const SEMILLA = { minisplit: '0cde809a-292d-4fbf-9eff-f16c9a71321d', laptop: '91675669-bd70-4fc0-b1a5-022d339d64ef' };
const VECINOS_TABASCO = '24278f23-1e68-447a-b0e9-0df9dae01960';
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const MAPA = {
  action: 'listings',
  query: { bounds: { west: -98.26, south: 19.0, east: -98.16, north: 19.08 } },
  coverage_center: { lat: 19.04, lng: -98.21 },
  revision: null,
  cell_cursor: null,
};

const resultados = [];
const caso = async (nombre, fn) => {
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true });
    console.log(`  OK    ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  } catch (e) {
    resultados.push({ nombre, ok: false });
    console.log(`  FALLO ${nombre} — ${e.message}`);
  }
};
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };
const paso = (titulo) => console.log(`\n${titulo}`);

// ---------------------------------------------------------------- fixtures

/** Ids de todo lo que crea este script: prefijo fx-ci- y las dos cuentas con UUID fijo. */
const MIOS = `(select id from auth.users where email like 'fx-ci-%' or email like 'vicino.qa.fx-ci-%'
                 or id in (${q(JAVIER)}, ${q(JAVIER_2)}))`;

const limpiarPropios = async () => {
  const hayActividad = (await sql(cfg.ref, "select to_regclass('public.actividad_diaria') is not null as hay"))[0].hay;
  await sql(
    cfg.ref,
    `begin;
     delete from public.communities where owner_id in ${MIOS} or fundador_id in ${MIOS}
        or id = ${q(VECINOS_TABASCO)} or nombre like '[FIXTURE]%';
     delete from public.messages where chat_id in (select id from public.chats where comprador_id in ${MIOS} or vendedor_id in ${MIOS});
     delete from public.reviews where reviewer_id in ${MIOS} or reviewed_id in ${MIOS};
     delete from public.loyalty_sellos_fallidos where seller_id in ${MIOS} or buyer_id in ${MIOS};
     delete from public.sale_confirmations where buyer_id in ${MIOS} or seller_id in ${MIOS};
     delete from public.chats where comprador_id in ${MIOS} or vendedor_id in ${MIOS};
     delete from public.favorites where usuario_id in ${MIOS};
     delete from public.seller_rankings where seller_id in ${MIOS};
     delete from public.request_responses where seller_id in ${MIOS};
     delete from public.purchase_requests where buyer_id in ${MIOS};
     delete from public.products_services where creador_id in ${MIOS};
     ${hayActividad ? `delete from public.actividad_diaria where user_id in ${MIOS};` : ''}
     delete from auth.users where id in ${MIOS};
     commit;`
  );
  const [r] = await sql(cfg.ref, `select count(*)::int as n from auth.users where id in ${MIOS}`);
  return r.n;
};

const admin = async (method, ruta, body) => {
  const res = await fetch(`${cfg.url}${ruta}`, {
    method,
    headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GoTrue admin ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

/** Cuenta sin sesion, con correo y (opcional) UUID elegidos. */
const crearCuenta = async (email, id) => {
  const u = await admin('POST', '/auth/v1/admin/users', {
    ...(id ? { id } : {}),
    email,
    password: crypto.randomBytes(18).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: `Fixture ${email.split('@')[0]}` },
  });
  if (id && u.id !== id) throw new Error(`GoTrue no respeto el id pedido (${u.id})`);
  return { id: u.id, email };
};

let categoria = null;
const producto = async (creador, titulo, { id, creadoEn } = {}) => {
  const [row] = await sql(
    cfg.ref,
    `insert into public.products_services
       (${id ? 'id, ' : ''}creador_id, titulo, descripcion, categoria, precio, estatus, ubicacion_geo${creadoEn ? ', created_at' : ''})
     values (${id ? `${q(id)}, ` : ''}${q(creador)}, ${q(`[FIXTURE] ${titulo}`)}, 'Producto sintetico de pruebas',
             ${q(categoria.slug)}, 650, 'disponible',
             ST_SetSRID(ST_MakePoint(${PUEBLA.lng}, ${PUEBLA.lat}), 4326)::geography${creadoEn ? `, ${q(creadoEn)}` : ''})
     returning id`
  );
  return row.id;
};

const solicitud = async (comprador, titulo) => {
  const [row] = await sql(
    cfg.ref,
    `insert into public.purchase_requests (buyer_id, title, description, status, expires_at, ubicacion_geo)
     values (${q(comprador)}, ${q(`[FIXTURE] ${titulo}`)}, 'Solicitud sintetica de pruebas', 'open', now() + interval '48 hours',
             ST_SetSRID(ST_MakePoint(${PUEBLA.lng}, ${PUEBLA.lat}), 4326)::geography)
     returning id`
  );
  return row.id;
};

const comunidad = async (dueno, nombre, miembros, autorPost, { id } = {}) => {
  const [row] = await sql(
    cfg.ref,
    `insert into public.communities (${id ? 'id, ' : ''}nombre, owner_id, centro, descripcion)
     values (${id ? `${q(id)}, ` : ''}${q(`[FIXTURE] ${nombre}`)}, ${q(dueno)},
             ST_SetSRID(ST_MakePoint(-98.21, 19.04), 4326)::geography, 'Comunidad sintetica de pruebas')
     returning id`
  );
  const filas = [`(${q(row.id)}, ${q(dueno)}, 'owner')`, ...miembros.map((m) => `(${q(row.id)}, ${q(m)}, 'member')`)];
  await sql(cfg.ref, `insert into public.community_members (community_id, user_id, role) values ${filas.join(', ')}`);
  await sql(cfg.ref, `insert into public.community_posts (community_id, author_id, cuerpo) values (${q(row.id)}, ${q(autorPost)}, 'Hola vecinos [FIXTURE]')`);
  return row.id;
};

/** Venta. Sembrada = insertada ya completada (no pasa por check_sale_completion). */
const venta = async (vendedor, comprador, prod, { sembrada = false, precio = 650, cantidad = 1 } = {}) => {
  if (sembrada) {
    const [row] = await sql(
      cfg.ref,
      `insert into public.sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by,
          buyer_confirmed, buyer_confirmed_at, seller_confirmed, seller_confirmed_at, status, completed_at, created_at)
       values (${q(prod)}, ${q(comprador)}, ${q(vendedor)}, ${precio}, ${cantidad}, ${q(vendedor)},
          true, now() - interval '6 days', true, now() - interval '6 days', 'completed', now() - interval '6 days', now() - interval '7 days')
       returning id`
    );
    return row.id;
  }
  const [row] = await sql(
    cfg.ref,
    `insert into public.sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by)
     values (${q(prod)}, ${q(comprador)}, ${q(vendedor)}, ${precio}, ${cantidad}, ${q(vendedor)}) returning id`
  );
  await sql(cfg.ref, `update public.sale_confirmations set buyer_confirmed = true, buyer_confirmed_at = now() where id = ${q(row.id)}`);
  const [s] = await sql(cfg.ref, `select status from public.sale_confirmations where id = ${q(row.id)}`);
  if (s.status !== 'completed') throw new Error(`la venta ${row.id} quedo ${s.status}`);
  return row.id;
};

const resena = (venta, prod, autor, calificado, tipo, rating) =>
  sql(
    cfg.ref,
    `insert into public.reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario)
     values (${q(venta)}, ${q(prod)}, ${q(autor)}, ${q(calificado)}, ${q(tipo)}, ${rating}, 'Resena [FIXTURE]')`
  );

const chat = async (comprador, vendedor, prod) => {
  const [c] = await sql(
    cfg.ref,
    `insert into public.chats (comprador_id, vendedor_id, ultimo_producto_id) values (${q(comprador)}, ${q(vendedor)}, ${q(prod)}) returning id`
  );
  await sql(
    cfg.ref,
    `insert into public.messages (chat_id, autor_id, texto, created_at) values
       (${q(c.id)}, ${q(comprador)}, 'Hola, ¿sigue disponible? [FIXTURE]', now() - interval '2 seconds'),
       (${q(c.id)}, ${q(vendedor)}, 'Si, claro [FIXTURE]', now() - interval '1 second')`
  );
  return c.id;
};

const perfil = async (id) =>
  (await sql(
    cfg.ref,
    `select is_hidden, trust_points, total_sales, trust_level::text as trust_level, reviews_count, average_rating
       from public.profiles where id = ${q(id)}`
  ))[0];

// ------------------------------------------------------------- migraciones

const archivoMigracion = (v) => path.join(REPO_ROOT, 'supabase', 'migrations', `${v}.sql`);
const archivoReversion = (v) => path.join(REPO_ROOT, 'docs', 'rollback', `${v}_rollback.sql`);

const aplicar = async () => {
  for (const v of MIGRACIONES) {
    await sql(cfg.ref, fs.readFileSync(archivoMigracion(v), 'utf8'));
    await sql(cfg.ref, `insert into supabase_migrations.schema_migrations(version, name) values (${q(v.slice(0, 14))}, ${q(v.slice(15))}) on conflict do nothing`);
  }
};

const revertir = async () => {
  for (const v of [...MIGRACIONES].reverse()) {
    await sql(cfg.ref, fs.readFileSync(archivoReversion(v), 'utf8'));
    await sql(cfg.ref, `delete from supabase_migrations.schema_migrations where version = ${q(v.slice(0, 14))}`);
  }
};

/** Respaldo de solo lectura del staging con el script real. Devuelve la carpeta. */
const respaldo = () => {
  const salida = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'respaldo-cuentas-internas.mjs'), '--staging'], { encoding: 'utf8' });
  const m = salida.match(/Respaldo de staging en (.+)/);
  if (!m) throw new Error(`respaldo sin carpeta: ${salida}`);
  return path.join(REPO_ROOT, m[1].trim());
};

// -------------------------------------------------------------- superficies

const titulos = (filas, campo = 'titulo') => (Array.isArray(filas) ? filas.map((f) => f[campo]) : []);

const superficies = async (u) => {
  const feed = await rpc(cfg, null, 'search_nearby_products_v4', { user_lat: PUEBLA.lat, user_lng: PUEBLA.lng, radius_meters: 5000 });
  const busca = await rpc(cfg, null, 'search_nearby_products_v4', { user_lat: PUEBLA.lat, user_lng: PUEBLA.lng, radius_meters: 5000, search_term: 'sintetico' });
  const mapa = await rpc(cfg, u.E2.token, 'search_map_publications_v3', { p_request: MAPA });
  const cerca = await rpc(cfg, null, 'count_nearby_vendors', { user_lat: PUEBLA.lat, user_lng: PUEBLA.lng, radius_meters: 5000 });
  const fichaS1 = await http(cfg, 'GET', `/rest/v1/products_services?select=id&id=eq.${u.pS1}`);
  const fichaSemilla = await http(cfg, 'GET', `/rest/v1/products_services?select=id&id=eq.${SEMILLA.minisplit}`);
  const fichaE1 = await http(cfg, 'GET', `/rest/v1/products_services?select=id&id=eq.${u.pE1}`);
  const tiendaS1 = await http(cfg, 'GET', `/rest/v1/profiles?select=id&id=eq.${u.S1.id}`);
  const tiendaJavier = await http(cfg, 'GET', `/rest/v1/profiles?select=id,total_sales,trust_points,reviews_count&id=eq.${JAVIER}`);
  // v2 es solo para authenticated (el invitado ve home_guest_requests_preview).
  const solicitudes = await rpc(cfg, u.E2.token, 'feed_nearby_requests_v2', { user_lat: PUEBLA.lat, user_lng: PUEBLA.lng, radius_meters: 5000 });
  const solicitudS1 = await http(cfg, 'GET', `/rest/v1/purchase_requests?select=id&id=eq.${u.rS1}`);
  const solicitudE3 = await http(cfg, 'GET', `/rest/v1/purchase_requests?select=id&id=eq.${u.rE3}`);
  const solicitudS1Sesion = await http(cfg, 'GET', `/rest/v1/purchase_requests?select=id&id=eq.${u.rS1}`, { token: u.E2.token });
  const solicitudE3Sesion = await http(cfg, 'GET', `/rest/v1/purchase_requests?select=id&id=eq.${u.rE3}`, { token: u.E2.token });
  const directorio = await rpc(cfg, u.E3.token, 'descubrir_comunidades', { p_lat: PUEBLA.lat, p_lng: PUEBLA.lng });
  const podio = await rpc(cfg, null, 'get_ranking_hiperlocal', {
    p_category_id: categoria.id, p_period: u.periodo, p_user_lat: PUEBLA.lat, p_user_lng: PUEBLA.lng, p_radius_meters: 5000, p_limit: 20,
  });
  const resenasJavier = await rpc(cfg, null, 'leer_resenas_local', { p_reviewed_id: JAVIER });
  for (const [k, r] of Object.entries({ feed, busca, mapa, cerca, solicitudes, directorio, podio })) {
    if (r.status !== 200) throw new Error(`${k}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return {
    feed: titulos(feed.body),
    busca: titulos(busca.body),
    mapa: titulos(mapa.body.listings),
    cerca: Number(cerca.body),
    fichaS1: fichaS1.body.length, fichaSemilla: fichaSemilla.body.length, fichaE1: fichaE1.body.length,
    tiendaS1: tiendaS1.body.length, tiendaJavier: tiendaJavier.body[0],
    solicitudes: titulos(solicitudes.body, 'title'),
    solicitudS1: solicitudS1.body.length, solicitudE3: solicitudE3.body.length,
    solicitudS1Sesion: solicitudS1Sesion.body.length, solicitudE3Sesion: solicitudE3Sesion.body.length,
    directorio: titulos(directorio.body, 'nombre'),
    podio: titulos(podio.body, 'seller_id'),
    resenasJavier: resenasJavier.status === 200 ? resenasJavier.body.summary.count : `HTTP ${resenasJavier.status}`,
  };
};

const tiene = (lista, texto) => lista.some((t) => String(t).includes(texto));

// ---------------------------------------------------------------- escenario

const escenario = async () => {
  [categoria] = await sql(cfg.ref, "select id, slug from public.categories where activo order by slug limit 1");
  const u = {};
  u.S1 = await crearCuenta(`fx-ci-${hex()}@mock-appstore.vicino.mx`);
  u.D1 = await crearCuenta(`fx-ci-${hex()}@demo.vicino.mx`);
  u.T1 = await crearCuenta(`fx-ci-javier-${hex()}@staging.vicino.test`, JAVIER);
  u.T2 = await crearCuenta(`fx-ci-javier2-${hex()}@staging.vicino.test`, JAVIER_2);
  u.QA = await crearCuenta(`vicino.qa.fx-ci-${hex()}@staging.vicino.test`);
  u.E1 = await crearUsuario(cfg, 'fx-ci-e1');
  u.E2 = await crearUsuario(cfg, 'fx-ci-e2');
  u.E3 = await crearUsuario(cfg, 'fx-ci-e3');

  u.pS1 = await producto(u.S1.id, 'Tacos sinteticos');
  u.pT1a = await producto(u.T1.id, 'Semilla minisplit', { id: SEMILLA.minisplit, creadoEn: '2026-09-26 04:19:07+00' });
  u.pT1b = await producto(u.T1.id, 'Semilla laptop', { id: SEMILLA.laptop, creadoEn: '2026-09-26 04:19:07+00' });
  u.pT1c = await producto(u.T1.id, 'Publicacion propia de Javier');
  u.pE1 = await producto(u.E1.id, 'Pan de E1');

  // Reputacion sembrada, como el seed: niveles coherentes con los puntos.
  await sql(cfg.ref, `update public.profiles set trust_points = 510, total_sales = 35, reviews_count = 17, average_rating = 4.8 where id = ${q(u.S1.id)}`);
  await sql(cfg.ref, `update public.profiles set trust_points = 520, total_sales = 41 where id = ${q(u.T1.id)}`);

  u.rS1 = await solicitud(u.S1.id, 'Busco algo sintetico');
  u.rE3 = await solicitud(u.E3.id, 'Busco algo real');

  u.cS = await comunidad(u.S1.id, 'Comunidad sintetica', [u.D1.id, u.T1.id], u.S1.id);
  u.cT = await comunidad(u.T1.id, 'Vecinos Tabasco 2000', [u.S1.id], u.S1.id, { id: VECINOS_TABASCO });
  u.cE = await comunidad(u.E1.id, 'Comunidad real', [u.E2.id], u.E1.id);

  u.vSembrada = await venta(u.T1.id, u.D1.id, u.pT1a, { sembrada: true });
  await resena(u.vSembrada, u.pT1a, u.D1.id, u.T1.id, 'buyer_to_seller', 5);
  u.vPrueba1 = await venta(u.T1.id, u.T2.id, u.pT1b);
  u.vPrueba2 = await venta(u.T1.id, u.E3.id, u.pT1a);
  await resena(u.vPrueba2, u.pT1a, u.E3.id, u.T1.id, 'buyer_to_seller', 4);
  u.vValida = await venta(u.E1.id, u.E2.id, u.pE1);
  await resena(u.vValida, u.pE1, u.E2.id, u.E1.id, 'buyer_to_seller', 5);

  await chat(u.E2.id, u.E1.id, u.pE1);
  await chat(u.T2.id, u.T1.id, u.pT1b);
  await sql(cfg.ref, `insert into public.favorites (usuario_id, producto_id) values (${q(u.E2.id)}, ${q(u.pE1)})`);

  // Rankings: lo que dejo el seed y lo que calculo el cron con la funcion vieja.
  const [p] = await sql(cfg.ref, "select to_char(now() at time zone 'America/Mexico_City', 'YYYY-MM') as periodo");
  u.periodo = p.periodo;
  await sql(
    cfg.ref,
    `insert into public.seller_rankings (seller_id, category_id, period, composite_score, ventas_count, ingresos, trust_points_snapshot)
     values (${q(u.S1.id)}, ${q(categoria.id)}, '2026-09', 940, 35, 12800, 510),
            (${q(u.T1.id)}, ${q(categoria.id)}, '2026-08', 915, 16, 22100, 480)`
  );
  await sql(cfg.ref, `select public.recompute_seller_rankings(${q(u.periodo)})`);
  return u;
};

// ------------------------------------------------------------------- main

const main = async () => {
  if (process.argv.includes('--solo-limpiar')) {
    console.log(`Fixtures retirados del staging ${cfg.ref} (quedan ${await limpiarPropios()}).`);
    return;
  }
  console.log(`staging ${cfg.ref}${CONSERVAR ? ' (conserva fixtures)' : ''}`);

  paso('0. Punto de partida igual a produccion');
  await caso('sin migraciones de cuentas internas ni fixtures previos', async () => {
    const [m] = await sql(cfg.ref, "select to_regclass('public.cuentas_internas') is not null as hay");
    const previos = await limpiarPropios();
    if (m.hay) await revertir();
    const [f] = await sql(cfg.ref, `select position('cuentas_internas' in pg_get_functiondef('public.check_sale_completion()'::regprocedure)) as n`);
    esperar(Number(f.n) === 0, 'check_sale_completion sigue con la version nueva');
    return `${m.hay ? 'revertidas las de una corrida anterior' : 'limpio'}; fixtures previos: ${previos}`;
  });

  const u = await escenario();
  try {
    paso('1. Antes: el problema se ve');
    const antes = await superficies(u);
    const jAntes = await perfil(JAVIER);
    await caso('lo sintetico y la semilla se ven en todas las superficies', async () => {
      esperar(tiene(antes.feed, 'Tacos sinteticos') && tiene(antes.feed, 'Semilla minisplit'), `feed: ${antes.feed}`);
      esperar(tiene(antes.busca, 'Tacos sinteticos'), `busqueda: ${antes.busca}`);
      esperar(tiene(antes.mapa, 'Tacos sinteticos'), `mapa: ${antes.mapa}`);
      esperar(antes.cerca === 3, `vendedores cerca: ${antes.cerca}`);
      esperar(antes.fichaS1 === 1 && antes.fichaSemilla === 1 && antes.tiendaS1 === 1, 'ficha/tienda sinteticas no visibles');
      esperar(tiene(antes.solicitudes, 'sintetico') && antes.solicitudS1 === 1, 'solicitud sintetica no visible');
      esperar(tiene(antes.directorio, 'Comunidad sintetica') && tiene(antes.directorio, 'Vecinos Tabasco'), `directorio: ${antes.directorio}`);
      esperar(antes.podio.includes(JAVIER), `podio sin Javier: ${antes.podio}`);
      esperar(antes.resenasJavier === 2, `resenas de Javier: ${antes.resenasJavier}`);
      return `feed ${antes.feed.length}, cerca ${antes.cerca}, directorio ${antes.directorio.length}, podio ${antes.podio.length}`;
    });
    await caso('la cuenta de Javier trae reputacion inflada', async () => {
      // 520 sembrados + 10 + 10 por las dos pruebas + 5 y 3 por las resenas.
      esperar(jAntes.trust_points === 548 && jAntes.total_sales === 43 && jAntes.trust_level === 'estrella', JSON.stringify(jAntes));
      return JSON.stringify(jAntes);
    });

    paso('2. Respaldo (solo lectura) y migraciones');
    const dirRespaldo = respaldo();
    await caso('respaldo escrito con restaurar.sql', async () => {
      const r = JSON.parse(fs.readFileSync(path.join(dirRespaldo, 'respaldo.json'), 'utf8'));
      esperar(r.perfiles.some((p) => p.id === JAVIER) && r.rankings.length >= 2, 'respaldo incompleto');
      esperar(fs.statSync(path.join(dirRespaldo, 'restaurar.sql')).size > 0, 'restaurar.sql vacio');
      return path.relative(REPO_ROOT, dirRespaldo);
    });
    // Las notificaciones de nivel que haya despues de este instante son de las
    // migraciones (el escenario mismo sube de nivel a las cuentas sembradas).
    const [{ t: alAplicar }] = await sql(cfg.ref, 'select now() as t');
    await caso('las cinco migraciones aplican (con sus verify)', async () => { await aplicar(); });
    await caso('las cinco son idempotentes (segunda corrida)', async () => { await aplicar(); });

    paso('3. Despues: datos');
    await caso('marca: sinteticas, equipo por UUID y prueba; externas no', async () => {
      const filas = await sql(cfg.ref, `select user_id, tipo from public.cuentas_internas where user_id in ${MIOS}`);
      const tipo = Object.fromEntries(filas.map((f) => [f.user_id, f.tipo]));
      esperar(tipo[u.S1.id] === 'sintetica' && tipo[u.D1.id] === 'sintetica', 'sinteticas sin marca');
      esperar(tipo[JAVIER] === 'equipo' && tipo[JAVIER_2] === 'equipo', 'cuentas de Javier sin marca');
      esperar(tipo[u.QA.id] === 'prueba', 'QA sin marca');
      esperar(!tipo[u.E1.id] && !tipo[u.E2.id] && !tipo[u.E3.id], 'una externa quedo marcada');
      return `${filas.length} marcadas`;
    });
    await caso('solo las sinteticas quedan ocultas', async () => {
      const filas = await sql(cfg.ref, `select id, is_hidden from public.profiles where id in ${MIOS}`);
      const oculto = Object.fromEntries(filas.map((f) => [f.id, f.is_hidden]));
      esperar(oculto[u.S1.id] && oculto[u.D1.id], 'sintetica visible');
      esperar(!oculto[JAVIER] && !oculto[JAVIER_2] && !oculto[u.QA.id] && !oculto[u.E1.id], 'se oculto una cuenta que no es sintetica');
    });
    await caso('reputacion: Javier sin ventas ni puntos sin origen; E3 sin los +3 de la prueba; E1 intacto', async () => {
      const j = await perfil(JAVIER);
      const e3 = await perfil(u.E3.id);
      const e1 = await perfil(u.E1.id);
      const e2 = await perfil(u.E2.id);
      esperar(j.total_sales === 0 && j.trust_points === 0 && j.trust_level === 'nuevo' && j.reviews_count === 0, `Javier: ${JSON.stringify(j)}`);
      esperar(e3.trust_points === 0, `E3: ${JSON.stringify(e3)}`);
      esperar(e1.total_sales === 1 && e1.trust_points === 15 && e1.reviews_count === 1, `E1: ${JSON.stringify(e1)}`);
      esperar(e2.trust_points === 5, `E2: ${JSON.stringify(e2)}`);
      const [n] = await sql(cfg.ref, `select count(*)::int as n from public.notifications where tipo = 'trust_upgrade' and created_at >= ${q(alAplicar)} and user_id in ${MIOS}`);
      esperar(n.n === 0, `${n.n} notificaciones de subida de nivel desde que se aplico`);
      return `Javier ${JSON.stringify(j)}`;
    });
    await caso('unidades vendidas: semilla en 0, la valida en 1', async () => {
      const filas = await sql(cfg.ref, `select id, ventas_count from public.products_services where id in (${q(u.pT1a)}, ${q(u.pT1b)}, ${q(u.pE1)})`);
      const v = Object.fromEntries(filas.map((f) => [f.id, f.ventas_count]));
      esperar(v[u.pT1a] === 0 && v[u.pT1b] === 0 && v[u.pE1] === 1, JSON.stringify(v));
    });
    await caso('resenas de ventas de prueba ocultas; la de la venta valida, visible', async () => {
      const filas = await sql(cfg.ref, `select sale_confirmation_id, is_hidden, visible from public.reviews where reviewer_id in ${MIOS}`);
      const prueba = filas.filter((f) => f.sale_confirmation_id !== u.vValida);
      const valida = filas.filter((f) => f.sale_confirmation_id === u.vValida);
      esperar(prueba.length === 2 && prueba.every((f) => f.is_hidden && !f.visible), JSON.stringify(prueba));
      esperar(valida.length === 1 && !valida[0].is_hidden, JSON.stringify(valida));
    });
    await caso('comunidades: la sintetica y Vecinos Tabasco ocultas, la real visible', async () => {
      const filas = await sql(cfg.ref, `select id, is_hidden from public.communities where id in (${q(u.cS)}, ${q(u.cT)}, ${q(u.cE)})`);
      const h = Object.fromEntries(filas.map((f) => [f.id, f.is_hidden]));
      esperar(h[u.cS] && h[u.cT] && !h[u.cE], JSON.stringify(h));
    });
    await caso('rankings: sin cuentas internas; E1 calculado', async () => {
      const filas = await sql(cfg.ref, `select seller_id, period, ventas_count from public.seller_rankings where seller_id in ${MIOS}`);
      esperar(!filas.some((f) => [u.S1.id, JAVIER].includes(f.seller_id)), JSON.stringify(filas));
      esperar(filas.some((f) => f.seller_id === u.E1.id && f.period === u.periodo && f.ventas_count === 1), JSON.stringify(filas));
    });

    paso('4. Despues: superficies (anon y con sesion)');
    const despues = await superficies(u);
    await caso('feed, busqueda y mapa sin lo sintetico ni la semilla; lo real sigue', async () => {
      for (const [k, lista] of Object.entries({ feed: despues.feed, busqueda: despues.busca, mapa: despues.mapa })) {
        esperar(!tiene(lista, 'Tacos sinteticos') && !tiene(lista, 'Semilla'), `${k}: ${lista}`);
      }
      esperar(tiene(despues.feed, 'Pan de E1') && tiene(despues.feed, 'Publicacion propia de Javier'), `feed: ${despues.feed}`);
      esperar(tiene(despues.mapa, 'Pan de E1'), `mapa: ${despues.mapa}`);
      return `feed ${antes.feed.length} -> ${despues.feed.length}, mapa ${antes.mapa.length} -> ${despues.mapa.length}`;
    });
    await caso('vendedores cerca: 3 -> 2', async () => { esperar(despues.cerca === 2, `${despues.cerca}`); });
    await caso('ficha y tienda por URL: la sintetica y la semilla dan vacio; lo real responde', async () => {
      esperar(despues.fichaS1 === 0 && despues.fichaSemilla === 0 && despues.tiendaS1 === 0, JSON.stringify(despues));
      esperar(despues.fichaE1 === 1, 'la ficha real desaparecio');
      const t = despues.tiendaJavier;
      esperar(t && t.total_sales === 0 && t.trust_points === 0 && t.reviews_count === 0, `tienda de Javier: ${JSON.stringify(t)}`);
    });
    await caso('solicitudes: el feed y la lectura por id ya no dan la sintetica; la real si', async () => {
      esperar(!tiene(despues.solicitudes, 'sintetico') && tiene(despues.solicitudes, 'real'), `${despues.solicitudes}`);
      esperar(despues.solicitudS1 === 0 && despues.solicitudE3 === 1, `anon: S1 ${despues.solicitudS1}, E3 ${despues.solicitudE3}`);
      esperar(despues.solicitudS1Sesion === 0 && despues.solicitudE3Sesion === 1,
        `con sesion: S1 ${despues.solicitudS1Sesion}, E3 ${despues.solicitudE3Sesion}`);
      esperar(antes.solicitudS1Sesion === 1, 'antes, con sesion, la sintetica se leia por id');
    });
    await caso('directorio de comunidades sin la sintetica ni Vecinos Tabasco; la real sigue', async () => {
      esperar(!tiene(despues.directorio, 'sintetica') && !tiene(despues.directorio, 'Vecinos Tabasco'), `${despues.directorio}`);
      esperar(tiene(despues.directorio, 'Comunidad real'), `${despues.directorio}`);
    });
    await caso('podio sin Javier ni sinteticas; con E1', async () => {
      esperar(!despues.podio.includes(JAVIER) && !despues.podio.includes(u.S1.id) && despues.podio.includes(u.E1.id), `${despues.podio}`);
    });
    await caso('resenas publicas de Javier: 2 -> 0', async () => { esperar(despues.resenasJavier === 0, `${despues.resenasJavier}`); });
    await caso('vistas previas de invitado sin lo sintetico (si el staging tiene cobertura de operacion)', async () => {
      const adm = (fn) => fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_limit: 50 }),
      }).then((r) => r.json());
      const [sol, com, posts] = await Promise.all([adm('home_guest_requests_preview'), adm('home_guest_communities_preview'), adm('home_guest_posts_preview')]);
      esperar([sol, com, posts].every(Array.isArray), `respuesta inesperada: ${JSON.stringify([sol, com, posts]).slice(0, 300)}`);
      // Por id (las descripciones de todos los fixtures dicen "sintetica"); las
      // publicaciones traen community_id, asi que caen en el mismo filtro.
      const texto = JSON.stringify([sol, com, posts]);
      for (const id of [u.rS1, u.cS, u.cT]) esperar(!texto.includes(id), `aparece ${id}: ${texto.slice(0, 300)}`);
      const vacio = sol.length + com.length + posts.length === 0;
      if (!vacio) esperar(sol.some((s) => s.id === u.rE3) && com.some((c) => c.id === u.cE), 'lo real no aparece: la prueba no distinguiria nada');
      return `solicitudes ${sol.length}, comunidades ${com.length}, publicaciones ${posts.length}${vacio ? ' (sin cobertura de operacion: no prueba nada)' : ''}`;
    });
    await caso('nada nuevo es legible por clientes: cuentas_internas, actividad_diaria, metricas', async () => {
      const r = [
        await http(cfg, 'GET', '/rest/v1/cuentas_internas?select=user_id', { token: u.E2.token }),
        await http(cfg, 'GET', '/rest/v1/cuentas_internas?select=user_id'),
        await http(cfg, 'GET', '/rest/v1/actividad_diaria?select=user_id', { token: u.E2.token }),
        await rpc(cfg, u.E2.token, 'metricas_resumen_externas', {}),
        await rpc(cfg, null, 'metricas_semanales_externas', { p_semanas: 2 }),
      ];
      esperar(r.every((x) => x.status >= 400), r.map((x) => x.status).join(','));
      return r.map((x) => x.status).join(', ');
    });

    paso('5. Reversion: rollbacks + restaurar.sql devuelven el estado del respaldo');
    await caso('revertir y restaurar deja los mismos valores que el respaldo', async () => {
      await revertir();
      await sql(cfg.ref, fs.readFileSync(path.join(dirRespaldo, 'restaurar.sql'), 'utf8'));
      const antesJson = JSON.parse(fs.readFileSync(path.join(dirRespaldo, 'respaldo.json'), 'utf8'));
      const dirOtra = respaldo();
      const ahora = JSON.parse(fs.readFileSync(path.join(dirOtra, 'respaldo.json'), 'utf8'));
      const diferencias = [];
      // computed_at no cuenta: la migracion recalcula el ranking de E1 en su
      // lugar (mismos valores, otra hora) y restaurar.sql no pisa recalculos.
      const sinHora = ({ computed_at: _hora, ...resto }) => JSON.stringify(resto);
      for (const tabla of ['perfiles', 'publicaciones', 'comunidades', 'resenas', 'rankings']) {
        const porId = new Map(ahora[tabla].map((x) => [x.id, sinHora(x)]));
        for (const x of antesJson[tabla]) if (porId.get(x.id) !== sinHora(x)) diferencias.push(`${tabla}:${x.id}`);
        if (ahora[tabla].length !== antesJson[tabla].length) diferencias.push(`${tabla}: ${antesJson[tabla].length} -> ${ahora[tabla].length} filas`);
      }
      fs.rmSync(dirOtra, { recursive: true, force: true });
      esperar(diferencias.length === 0, diferencias.slice(0, 8).join(' | '));
      const [f] = await sql(cfg.ref, `select position('cuentas_internas' in pg_get_functiondef('public.check_sale_completion()'::regprocedure)) as n,
        to_regclass('public.cuentas_internas') is null as sin_tabla`);
      esperar(Number(f.n) === 0 && f.sin_tabla, 'las funciones o la tabla siguen');
      return 'perfiles, publicaciones, comunidades, resenas y rankings iguales';
    });
    await caso('se vuelven a aplicar las cinco', async () => { await aplicar(); });
    // El respaldo del staging solo servia para este ensayo.
    fs.rmSync(dirRespaldo, { recursive: true, force: true });

    paso('6. En adelante: las pruebas ya no inflan');
    await caso('una venta de Javier a una externa se completa sin sumar a nadie (resena con la clave de servicio)', async () => {
      const antesE2 = await perfil(u.E2.id);
      const v = await venta(JAVIER, u.E2.id, u.pT1c);
      // Por PostgREST con service_role: el disparador de visibilidad corre con
      // ese rol, que no tiene USAGE sobre vicino_guard ni lee cuentas_internas.
      const ins = await fetch(`${cfg.url}/rest/v1/reviews`, {
        method: 'POST',
        headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ sale_confirmation_id: v, product_id: u.pT1c, reviewer_id: u.E2.id, reviewed_id: JAVIER,
          review_type: 'buyer_to_seller', rating: 5, comentario: 'Resena [FIXTURE]' }),
      });
      esperar(ins.status === 201, `insert con service_role: HTTP ${ins.status} ${(await ins.text()).slice(0, 200)}`);
      const j = await perfil(JAVIER);
      const e2 = await perfil(u.E2.id);
      const [p] = await sql(cfg.ref, `select ventas_count from public.products_services where id = ${q(u.pT1c)}`);
      const [r] = await sql(cfg.ref, `select is_hidden, visible from public.reviews where sale_confirmation_id = ${q(v)}`);
      esperar(j.total_sales === 0 && j.trust_points === 0 && j.reviews_count === 0, `Javier: ${JSON.stringify(j)}`);
      esperar(e2.trust_points === antesE2.trust_points, `E2 ${antesE2.trust_points} -> ${e2.trust_points}`);
      esperar(p.ventas_count === 0, `ventas_count ${p.ventas_count}`);
      esperar(r.is_hidden && !r.visible, `la resena de la prueba nacio visible: ${JSON.stringify(r)}`);
    });
    await caso('una venta entre independientes suma como siempre', async () => {
      const v = await venta(u.E1.id, u.E3.id, u.pE1, { cantidad: 2 });
      await resena(v, u.pE1, u.E3.id, u.E1.id, 'buyer_to_seller', 4);
      const e1 = await perfil(u.E1.id);
      const e3 = await perfil(u.E3.id);
      const [p] = await sql(cfg.ref, `select ventas_count from public.products_services where id = ${q(u.pE1)}`);
      esperar(e1.total_sales === 2 && e1.trust_points === 15 + 10 + 3, `E1: ${JSON.stringify(e1)}`);
      esperar(e3.trust_points === 3 + 2, `E3: ${JSON.stringify(e3)}`);
      esperar(p.ventas_count === 3, `ventas_count ${p.ventas_count}`);
    });
    await caso('la resena que escribe una cuenta interna (sin venta) nace oculta', async () => {
      const antes = await perfil(u.E1.id);
      await sql(cfg.ref, `insert into public.reviews (reviewer_id, reviewed_id, review_type, rating, comentario, origen)
        values (${q(u.QA.id)}, ${q(u.E1.id)}, 'buyer_to_seller', 1, 'Resena de QA [FIXTURE]', 'local')`);
      const [r] = await sql(cfg.ref, `select is_hidden, visible from public.reviews where reviewer_id = ${q(u.QA.id)}`);
      const despues = await perfil(u.E1.id);
      esperar(r.is_hidden && !r.visible, `resena de QA visible: ${JSON.stringify(r)}`);
      esperar(despues.reviews_count === antes.reviews_count && despues.average_rating === antes.average_rating,
        `la calificacion de E1 se movio: ${JSON.stringify(antes)} -> ${JSON.stringify(despues)}`);
    });
    await caso('cancelar una venta de prueba no le cuesta puntos a la persona real', async () => {
      const antesE2 = await perfil(u.E2.id);
      const [s] = await sql(cfg.ref, `insert into public.sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by)
        values (${q(u.pT1c)}, ${q(u.E2.id)}, ${q(JAVIER)}, 650, 1, ${q(JAVIER)}) returning id`);
      await sql(cfg.ref, `update public.sale_confirmations set status = 'cancelled', cancelled_by = ${q(u.E2.id)}, cancelled_at = now()
        where id = ${q(s.id)}`);
      const e2 = await perfil(u.E2.id);
      esperar(e2.trust_points === antesE2.trust_points, `E2 ${antesE2.trust_points} -> ${e2.trust_points}`);
    });
    await caso('recalcular el ranking del mes: E1 con 2 ventas, sin Javier', async () => {
      await sql(cfg.ref, `select public.recompute_seller_rankings(${q(u.periodo)})`);
      const filas = await sql(cfg.ref, `select seller_id, ventas_count from public.seller_rankings where period = ${q(u.periodo)} and seller_id in ${MIOS}`);
      esperar(filas.length === 1 && filas[0].seller_id === u.E1.id && filas[0].ventas_count === 2, JSON.stringify(filas));
    });

    paso('7. Metricas y actividad');
    await caso('marcar_visto: una fila por dia, solo con sesion', async () => {
      const a = await rpc(cfg, u.E2.token, 'marcar_visto', {});
      const b = await rpc(cfg, u.E2.token, 'marcar_visto', {});
      const anon = await rpc(cfg, null, 'marcar_visto', {});
      esperar(a.status === 204 && b.status === 204, `con sesion: ${a.status}/${b.status} ${JSON.stringify(a.body)}`);
      esperar(anon.status >= 400, `anon: ${anon.status}`);
      const [n] = await sql(cfg.ref, `select count(*)::int as n from public.actividad_diaria where user_id = ${q(u.E2.id)}`);
      esperar(n.n === 1, `${n.n} filas`);
      return `anon HTTP ${anon.status}`;
    });
    await caso('metricas: solo cuentas externas', async () => {
      const [s] = await sql(cfg.ref, 'select * from public.metricas_semanales_externas(1)');
      const [r] = await sql(cfg.ref, 'select * from public.metricas_resumen_externas()');
      // Esta semana: E1->E2 y E1->E3. Las de Javier no cuentan.
      esperar(s.ventas_completadas === 2 && Number(s.gmv_mxn) === 1300, `semana: ${JSON.stringify(s)}`);
      esperar(s.chats_calificados === 1 && s.chats_iniciados === 1, `chats: ${JSON.stringify(s)}`);
      esperar(s.vendedores_activos >= 1 && s.usuarios_con_visita >= 1, `actividad: ${JSON.stringify(s)}`);
      esperar(r.ventas_entre_independientes === 2 && r.chats_calificados === 1, `resumen: ${JSON.stringify(r)}`);
      const [sint] = await sql(cfg.ref, `select count(*)::int as n from public.profiles p join public.cuentas_internas ci on ci.user_id = p.id where p.id in ${MIOS}`);
      return `semana ${JSON.stringify(s)} · resumen ${JSON.stringify(r)} · internas excluidas ${sint.n}`;
    });
  } finally {
    if (CONSERVAR) {
      console.log('\nFixtures conservados (--conservar). Para retirarlos: vuelve a correr sin --conservar.');
    } else {
      const quedan = await limpiarPropios();
      console.log(`\nFixtures retirados (quedan ${quedan}). Migraciones aplicadas en el staging.`);
    }
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(fallos ? `\n${fallos} caso(s) fallaron de ${resultados.length}` : `\nOK: ${resultados.length} casos en staging`);
  process.exit(fallos ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e.stack || e.message);
  if (!CONSERVAR) {
    try { await limpiarPropios(); } catch (err) { console.error(`limpieza: ${err.message}`); }
  }
  process.exit(1);
});
