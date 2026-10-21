#!/usr/bin/env node
/**
 * S13 — proyección pública v2 (~110 m) y search_map_publications_v3 contra el
 * STAGING, con PostGIS 3.3 real y PostgREST real (lo que PGlite no puede probar:
 * geometría generada de verdad, GiST, privilegios de columna por HTTP).
 *
 *   node scripts/staging/probar-mapa-v3.mjs
 *
 * Aplica la migración 20261020150000 al staging si aún no está, crea tres
 * vendedores en la misma manzana de Tlaxcalancingo (y uno a ~350 m) y comprueba
 * que v2 los apila en UNA celda de 1 km y v3 los separa. Retira los fixtures al
 * final. Sale con 1 si algún caso no cumple.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { staging, http, rpc, crearUsuario, limpiar } from './fixtures.mjs';
import { sql, REPO_ROOT } from './lib.mjs';

const cfg = staging();
const MIGRACION = '20261020150000_mapa_puntos_precisos_v3.sql';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const caso = async (nombre, fn) => {
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true });
    console.log(`  OK   ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  } catch (e) {
    resultados.push({ nombre, ok: false });
    console.log(`  FALLO ${nombre} — ${e.message}`);
  }
};
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };

// Misma manzana (menos de ~60 m entre A1, A2 y B1); C1 a ~350 m. Todas en la
// misma celda de 0.01° (-98.21, 19.04) de la proyección v1.
const PUNTOS = {
  A1: { lng: -98.2063, lat: 19.0414 }, A2: { lng: -98.2061, lat: 19.0412 },
  B1: { lng: -98.2059, lat: 19.0411 }, C1: { lng: -98.2077, lat: 19.0438 },
};
const base = { bounds: { west: -98.26, south: 19.0, east: -98.16, north: 19.08 } };
const centro = { lat: 19.04, lng: -98.21 };
const peticion = (action, extra = {}) => ({ p_request: { action, query: base, coverage_center: centro, revision: null, cell_cursor: null, ...extra } });

const asegurarMigracion = async () => {
  const [fn] = await sql(cfg.ref, "select count(*)::int as n from pg_proc where proname = 'search_map_publications_v3'");
  if (fn.n === 1) return 'ya estaba aplicada';
  const archivo = path.join(REPO_ROOT, 'supabase', 'migrations', MIGRACION);
  await sql(cfg.ref, fs.readFileSync(archivo, 'utf8'));
  await sql(cfg.ref, `insert into supabase_migrations.schema_migrations(version, name) values (${q(MIGRACION.slice(0, 14))}, ${q(MIGRACION.slice(15, -4))}) on conflict do nothing`);
  return 'aplicada en esta corrida';
};

const crearProductoEn = async (creadorId, titulo, { lat, lng }) => {
  const [cat] = await sql(cfg.ref, 'select slug from public.categories order by slug limit 1');
  const [row] = await sql(
    cfg.ref,
    `insert into public.products_services (creador_id, titulo, descripcion, categoria, precio, estatus, ubicacion_geo)
     values (${q(creadorId)}, ${q(`[FIXTURE] ${titulo}`)}, 'Producto sintetico de pruebas', ${q(cat?.slug ?? 'otros')}, 50, 'disponible',
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
     returning id`
  );
  return row.id;
};

const main = async () => {
  console.log(`staging ${cfg.ref}`);
  await caso('migración 20261020150000 presente en staging', asegurarMigracion);

  const ana = await crearUsuario(cfg, 'mapa-ana');
  const bruno = await crearUsuario(cfg, 'mapa-bruno');
  const carla = await crearUsuario(cfg, 'mapa-carla');
  const visitante = await crearUsuario(cfg, 'mapa-visitante');
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id in (${[ana, bruno, carla].map((u) => q(u.id)).join(',')})`);
  const ids = {
    A1: await crearProductoEn(ana.id, 'Strudel de manzana', PUNTOS.A1),
    A2: await crearProductoEn(ana.id, 'Pan de la casa', PUNTOS.A2),
    B1: await crearProductoEn(bruno.id, 'Uñas acrílicas', PUNTOS.B1),
    C1: await crearProductoEn(carla.id, 'Clases de guitarra', PUNTOS.C1),
  };
  const mios = `(${Object.values(ids).map(q).join(',')})`;
  try {
    await caso('la columna generada redondea a 3 decimales con PostGIS real', async () => {
      const filas = await sql(cfg.ref, `select titulo, ST_AsText(ubicacion_publica) as publica, ST_AsText(ubicacion_mapa) as mapa from public.products_services where id in ${mios} order by titulo`);
      const porTitulo = Object.fromEntries(filas.map((f) => [f.titulo.replace('[FIXTURE] ', ''), f]));
      esperar(porTitulo['Strudel de manzana'].publica === 'POINT(-98.206 19.041)', `A1 publica: ${porTitulo['Strudel de manzana'].publica}`);
      esperar(porTitulo['Uñas acrílicas'].publica === 'POINT(-98.206 19.041)', `B1 publica: ${porTitulo['Uñas acrílicas'].publica}`);
      esperar(porTitulo['Clases de guitarra'].publica === 'POINT(-98.208 19.044)', `C1 publica: ${porTitulo['Clases de guitarra'].publica}`);
      esperar(filas.every((f) => f.mapa === 'POINT(-98.21 19.04)'), 'v1 debería apilar las cuatro en POINT(-98.21 19.04)');
      return filas.map((f) => f.publica).join(' | ');
    });
    await caso('la columna nueva no es legible por clientes (catálogo y PostgREST)', async () => {
      const priv = await sql(cfg.ref, `select has_column_privilege('anon','public.products_services','ubicacion_publica','SELECT') as anon,
        has_column_privilege('authenticated','public.products_services','ubicacion_publica','SELECT') as auth`);
      esperar(priv[0].anon === false && priv[0].auth === false, `privilegios: ${JSON.stringify(priv[0])}`);
      const r = await http(cfg, 'GET', `/rest/v1/products_services?select=id,ubicacion_publica&id=eq.${ids.A1}`, { token: visitante.token });
      esperar(r.status !== 200, `PostgREST devolvió ${r.status} al pedir ubicacion_publica`);
      return `HTTP ${r.status} con sesión`;
    });
    await caso('v2 (1 km) apila a los tres vendedores en una celda; v3 (110 m) separa al de 350 m', async () => {
      const viejo = await rpc(cfg, visitante.token, 'search_map_publications_v2', peticion('cells'));
      esperar(viejo.status === 200, `v2: HTTP ${viejo.status} ${JSON.stringify(viejo.body).slice(0, 200)}`);
      const celdasViejas = viejo.body.cells.filter((c) => c.x === -9821 && c.y === 1904);
      esperar(celdasViejas.length === 1 && celdasViejas[0].count >= 4, `v2 cells: ${JSON.stringify(viejo.body.cells)}`);
      const nuevo = await rpc(cfg, visitante.token, 'search_map_publications_v3', peticion('cells'));
      esperar(nuevo.status === 200, `v3: HTTP ${nuevo.status} ${JSON.stringify(nuevo.body).slice(0, 200)}`);
      esperar(nuevo.body.projection_version === 2, `projection_version ${nuevo.body.projection_version}`);
      const manzana = nuevo.body.cells.find((c) => c.x === -98206 && c.y === 19041);
      const lejos = nuevo.body.cells.find((c) => c.x === -98208 && c.y === 19044);
      esperar(manzana && manzana.count >= 3 && manzana.seller_count >= 2, `celda de la manzana: ${JSON.stringify(manzana)}`);
      esperar(lejos && lejos.count >= 1, `celda a 350 m: ${JSON.stringify(lejos)}`);
      const texto = JSON.stringify(nuevo.body);
      for (const secreto of ['-98.2063', '-98.2061', '-98.2059', '-98.2077', '19.0414', '19.0412', '19.0411', '19.0438']) esperar(!texto.includes(secreto), `coordenada exacta expuesta: ${secreto}`);
      return `v2: 1 celda con ${celdasViejas[0].count}; v3: manzana ${manzana.count}/${manzana.seller_count} vendedores + 1 aparte`;
    });
    await caso('el detalle de la celda de 110 m lista exactamente a sus miembros con nombre público', async () => {
      const vista = await rpc(cfg, visitante.token, 'search_map_publications_v3', peticion('overview'));
      const detalle = await rpc(cfg, visitante.token, 'search_map_publications_v3', peticion('listings', { query: { ...base, cell_id: 'cell:1:-98206:19041' }, revision: vista.body.revision }));
      esperar(detalle.status === 200, `listings: HTTP ${detalle.status} ${JSON.stringify(detalle.body).slice(0, 200)}`);
      const titulos = detalle.body.listings.map((l) => l.titulo).filter((t) => t.startsWith('[FIXTURE]')).sort();
      esperar(titulos.length === 3 && !titulos.some((t) => t.includes('guitarra')), `titulos: ${titulos.join(', ')}`);
      esperar(detalle.body.listings.every((l) => l.cell_id === 'cell:1:-98206:19041' && !('ubicacion' in l) && !('public_lat' in l)), 'campos privados o celda ajena en el detalle');
      return titulos.join(', ');
    });
    await caso('sin sesión no se puede ejecutar v3 (igual que v2)', async () => {
      const r = await rpc(cfg, null, 'search_map_publications_v3', peticion('overview'));
      esperar(r.status === 401 || r.status === 403, `anon obtuvo HTTP ${r.status}`);
      return `HTTP ${r.status}`;
    });
    await caso('v1, v2 y v3 existen exactamente una vez y el índice GiST está', async () => {
      const fns = await sql(cfg.ref, "select proname, count(*)::int as n from pg_proc where proname like 'search_map_publications_v%' group by 1 order by 1");
      esperar(fns.length === 3 && fns.every((f) => f.n === 1), JSON.stringify(fns));
      const idx = await sql(cfg.ref, "select indexname from pg_indexes where tablename = 'products_services' and indexname = 'idx_products_services_publica'");
      esperar(idx.length === 1, 'falta idx_products_services_publica');
    });
    await caso('tiempo de la vista general por PostgREST (informativo)', async () => {
      const tiempos = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        const r = await rpc(cfg, visitante.token, 'search_map_publications_v3', peticion('overview'));
        esperar(r.status === 200, `HTTP ${r.status}`);
        tiempos.push(performance.now() - t0);
      }
      tiempos.sort((a, b) => a - b);
      return `p50 ${Math.round(tiempos[4])} ms · p95 ${Math.round(tiempos[9])} ms (incluye red; catálogo del staging, no producción)`;
    });
  } finally {
    await limpiar(cfg);
  }
  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(fallos ? `\n${fallos} caso(s) fallaron` : `\nOK: ${resultados.length} casos en staging con PostGIS real`);
  process.exit(fallos ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e.message);
  try { await limpiar(cfg); } catch {}
  process.exit(1);
});
