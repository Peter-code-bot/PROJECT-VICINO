#!/usr/bin/env node
/**
 * GEO-PUB-EXACT — ubicacion exacta por publicacion contra el STAGING, con
 * PostGIS 3.3, PostgREST, RLS, privilegios por columna y triggers reales (lo
 * que una prueba local no puede imitar).
 *
 *   node scripts/staging/probar-ubicacion-exacta.mjs
 *
 * Aplica 20261108210000 al staging si su version no esta en el ledger, crea dos
 * vendedores (una publicacion historica aproximada y una que pasa a exacta), una
 * cuenta visitante y un invitado sin sesion, y comprueba:
 *   - que el dueno escribe el modo con su token y el trigger deriva el punto
 *     exacto y la revision; que nadie escribe ubicacion_exacta ni la revision a
 *     mano; que otra cuenta no toca la publicacion ajena;
 *   - que ninguna cuenta lee las columnas nuevas por PostgREST;
 *   - que v4 pinta el punto exacto solo de la exacta, con las dos rejillas, y
 *     que la aproximada no suelta su punto privado;
 *   - que editar el precio no cambia ni el modo ni la revision, y que pasar a
 *     aproximada revoca el punto exacto y cambia la revision del mapa;
 *   - que la funcion de la ficha y el minimapa solo la ejecuta service_role y
 *     devuelve el mismo dato que v4.
 * Retira los fixtures al final. Sale con 1 si algun caso no cumple.
 */
import fs from 'node:fs';
import path from 'node:path';
import { staging, http, rpc, crearUsuario, bloquear, limpiar } from './fixtures.mjs';
import { sql, REPO_ROOT } from './lib.mjs';

const cfg = staging();
const MIGRACION = '20261108210000_ubicacion_exacta_por_publicacion.sql';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
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

// Puntos sinteticos en Tlaxcalancingo. EXACTA se publica tal cual. HISTORICA
// (a ~250 m, otra celda en las dos rejillas) y VECINA (en la MISMA celda de 110 m
// que EXACTA) nunca deben aparecer con estos decimales en una respuesta publica.
const EXACTA = { lng: -98.20637, lat: 19.04138 };
const MOVIDA = { lng: -98.20691, lat: 19.04177 };
const HISTORICA = { lng: -98.2041, lat: 19.04009 };
const VECINA = { lng: -98.20593, lat: 19.04109 };
const base = { bounds: { west: -98.26, south: 19.0, east: -98.16, north: 19.08 } };
const centro = { lat: 19.04, lng: -98.21 };
const peticion = (action, extra = {}) => ({ p_request: { action, query: base, coverage_center: centro, revision: null, cell_cursor: null, ...extra } });
const ewkt = ({ lng, lat }) => `SRID=4326;POINT(${lng} ${lat})`;

const asegurarMigracion = async () => {
  const version = MIGRACION.slice(0, 14);
  const [fila] = await sql(cfg.ref, `select count(*)::int as n from supabase_migrations.schema_migrations where version = ${q(version)}`);
  if (fila.n === 1) return 'ya estaba aplicada';
  const archivo = path.join(REPO_ROOT, 'supabase', 'migrations', MIGRACION);
  await sql(cfg.ref, `begin;\n${fs.readFileSync(archivo, 'utf8')}\ninsert into supabase_migrations.schema_migrations(version, name) values (${q(version)}, ${q(MIGRACION.slice(15, -4))}) on conflict do nothing;\ncommit;`);
  return 'aplicada en esta corrida';
};

/** Vendedor por el camino que exige la base (ver probar-mapa-v3.mjs). */
const habilitarVendedor = async (userId) => {
  const vigente = (doc) => `(select version from public.legal_documents where documento = '${doc}' and vigente_desde <= now() order by vigente_desde desc, publicado_en desc limit 1)`;
  await sql(
    cfg.ref,
    `begin;
     select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
     select public.confirmar_documentos_cuenta(${vigente('terminos')}, ${vigente('aviso')}, true, true);
     update public.profiles set es_vendedor = true, seller_visibility_confirmed_at = now(), seller_visibility_version = 'vendedor-v1'
       where id = ${q(userId)};
     commit;`
  );
};

/** Historica: como postgres y SIN la columna nueva, igual que el codigo de master. */
const crearHistorica = async (creadorId, titulo, punto) => {
  const [cat] = await sql(cfg.ref, 'select slug from public.categories order by slug limit 1');
  const [row] = await sql(
    cfg.ref,
    `insert into public.products_services (creador_id, titulo, descripcion, categoria, precio, estatus, ubicacion_geo)
     values (${q(creadorId)}, ${q(`[FIXTURE] ${titulo}`)}, 'Producto sintetico de pruebas', ${q(cat?.slug ?? 'otros')}, 50, 'disponible',
             ST_SetSRID(ST_MakePoint(${punto.lng}, ${punto.lat}), 4326)::geography)
     returning id`
  );
  return row.id;
};

const fila = async (id) => {
  const [f] = await sql(cfg.ref, `select ubicacion_precision as precision, ubicacion_revision::int as revision,
      ST_AsText(ubicacion_exacta) as exacta, ST_AsText(ubicacion_geo::geometry) as geo, precio::float8 as precio
    from public.products_services where id = ${q(id)}`);
  return f;
};

const sinCoordenadas = (texto, punto, etiqueta) => {
  for (const v of [String(punto.lng), String(punto.lat)]) esperar(!texto.includes(v), `${etiqueta}: aparece ${v}`);
};

const main = async () => {
  console.log(`staging ${cfg.ref}`);
  await caso(`migracion ${MIGRACION.slice(0, 14)} presente en staging`, asegurarMigracion);

  const ana = await crearUsuario(cfg, 'exacta-ana');
  const bruno = await crearUsuario(cfg, 'exacta-bruno');
  const visitante = await crearUsuario(cfg, 'exacta-visitante');
  const bloqueado = await crearUsuario(cfg, 'exacta-bloqueado');
  for (const u of [ana, bruno]) await habilitarVendedor(u.id);
  const [cat] = await sql(cfg.ref, 'select slug from public.categories order by slug limit 1');

  // Ana publica por PostgREST con SU token (como la Server Action): el INSERT de
  // tabla le deja mandar ubicacion_exacta y la revision; el trigger los pisa.
  const alta = await http(cfg, 'POST', '/rest/v1/products_services?select=id', {
    token: ana.token,
    prefer: 'return=representation',
    body: {
      creador_id: ana.id, titulo: '[FIXTURE] Pan de la esquina', descripcion: 'Producto sintetico de pruebas',
      categoria: cat?.slug ?? 'otros', precio: 40, estatus: 'disponible', ubicacion_geo: ewkt(EXACTA),
      ubicacion_precision: 'exacta', ubicacion_exacta: ewkt(HISTORICA), ubicacion_revision: 99,
    },
  });
  const idExacta = Array.isArray(alta.body) ? alta.body[0]?.id : null;
  const idHistorica = await crearHistorica(bruno.id, 'Tamales de antes', HISTORICA);
  const mios = `(${[idExacta, idHistorica].filter(Boolean).map(q).join(',')})`;

  try {
    await caso('el dueno publica en exacta con su token y el trigger deriva el punto de ubicacion_geo', async () => {
      esperar(alta.status === 201 && idExacta, `alta: HTTP ${alta.status} ${JSON.stringify(alta.body).slice(0, 300)}`);
      const f = await fila(idExacta);
      esperar(f.precision === 'exacta', `precision ${f.precision}`);
      esperar(f.exacta === `POINT(${EXACTA.lng} ${EXACTA.lat})`, `exacta ${f.exacta} (deberia salir de ubicacion_geo, no del valor mandado)`);
      esperar(f.revision === 0, `revision ${f.revision} (el cliente mando 99)`);
      return `${f.exacta}, revision ${f.revision}`;
    });

    await caso('la historica nace aproximada, sin punto exacto y con revision 0', async () => {
      const f = await fila(idHistorica);
      esperar(f.precision === 'aproximada' && f.exacta === null && f.revision === 0, JSON.stringify(f));
    });

    await caso('ninguna cuenta lee las columnas nuevas por PostgREST', async () => {
      const estados = [];
      for (const col of ['ubicacion_exacta', 'ubicacion_precision', 'ubicacion_revision']) {
        for (const [quien, token] of [['dueno', ana.token], ['visitante', visitante.token], ['anon', null]]) {
          const r = await http(cfg, 'GET', `/rest/v1/products_services?select=id,${col}&id=eq.${idExacta}`, { token });
          esperar(r.status !== 200, `${quien} leyo ${col} (HTTP 200)`);
          estados.push(r.status);
        }
      }
      return `HTTP ${[...new Set(estados)].join('/')}`;
    });

    await caso('nadie escribe ubicacion_exacta ni la revision a mano', async () => {
      const a = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_exacta: ewkt(HISTORICA) } });
      const b = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_revision: 7 } });
      esperar(a.status >= 400 && b.status >= 400, `HTTP ${a.status} y ${b.status}`);
      const f = await fila(idExacta);
      esperar(f.exacta === `POINT(${EXACTA.lng} ${EXACTA.lat})` && f.revision === 0, JSON.stringify(f));
      return `HTTP ${a.status} y ${b.status}`;
    });

    await caso('otra cuenta no cambia el modo de una publicacion ajena', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: visitante.token, prefer: 'return=representation', body: { ubicacion_precision: 'aproximada' } });
      const f = await fila(idExacta);
      esperar(f.precision === 'exacta', `quedo ${f.precision} tras HTTP ${r.status}`);
      return `HTTP ${r.status}, ${Array.isArray(r.body) ? r.body.length : 0} filas`;
    });

    await caso('un modo invalido se rechaza', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_precision: 'casi' } });
      esperar(r.status >= 400, `HTTP ${r.status}`);
      return `HTTP ${r.status}`;
    });

    for (const rejilla of [2, 3]) {
      await caso(`v4 (rejilla ${rejilla}): la exacta trae su punto y la aproximada solo su celda`, async () => {
        const r = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla }));
        esperar(r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        esperar(r.body.projection_version === 2, `projection_version ${r.body.projection_version}`);
        const conPunto = r.body.cells.filter((c) => c.punto);
        const exacta = conPunto.find((c) => c.punto.lat === EXACTA.lat && c.punto.lng === EXACTA.lng);
        esperar(exacta && exacta.count === 1, `celda exacta: ${JSON.stringify(conPunto)}`);
        esperar(exacta.x === Math.round(EXACTA.lng * 1000) && exacta.y === Math.round(EXACTA.lat * 1000), `nodo de la exacta ${exacta.x},${exacta.y}`);
        const factor = rejilla === 3 ? 1 : 10;
        const nodo = { x: Math.round((HISTORICA.lng * 1000) / factor) * factor, y: Math.round((HISTORICA.lat * 1000) / factor) * factor };
        const aprox = r.body.cells.find((c) => c.x === nodo.x && c.y === nodo.y);
        esperar(aprox && !aprox.punto, `celda aproximada en ${nodo.x},${nodo.y}: ${JSON.stringify(aprox)}`);
        sinCoordenadas(JSON.stringify(r.body), HISTORICA, 'v4');
        return `exacta en (${exacta.punto.lat}, ${exacta.punto.lng}); aproximada en el nodo ${nodo.x},${nodo.y}`;
      });
    }

    await caso('v4 sin rejilla usa la de 1 km, y rechaza una rejilla invalida', async () => {
      const sin = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells'));
      const nodo = { x: Math.round(HISTORICA.lng * 100) * 10, y: Math.round(HISTORICA.lat * 100) * 10 };
      esperar(sin.status === 200 && sin.body.cells.some((c) => c.x === nodo.x && c.y === nodo.y), `sin rejilla: ${JSON.stringify(sin.body).slice(0, 200)}`);
      const mala = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 4 }));
      esperar(mala.status >= 400, `rejilla 4: HTTP ${mala.status}`);
      return `rejilla 4: HTTP ${mala.status}`;
    });

    await caso('la vista general marca la exacta y no inventa precision para la aproximada', async () => {
      // Encuadre de ~1 km: stride 1, cada celda de 110 m es su propio nodo.
      const cerca = { bounds: { west: EXACTA.lng - 0.005, south: EXACTA.lat - 0.005, east: EXACTA.lng + 0.005, north: EXACTA.lat + 0.005 } };
      const r = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('overview', { rejilla: 3, query: cerca }));
      esperar(r.status === 200, `HTTP ${r.status}`);
      const marcadas = r.body.features.filter((f) => f.precision === 'exacta');
      esperar(marcadas.some((f) => f.public_lat === EXACTA.lat && f.public_lng === EXACTA.lng), `features exactas: ${JSON.stringify(marcadas)}`);
      esperar(r.body.features.every((f) => f.precision === undefined || f.precision === 'exacta'), 'precision con otro valor');
      sinCoordenadas(JSON.stringify(r.body), HISTORICA, 'overview');
    });

    await caso('una exacta que comparte su celda de 110 m se cuenta en la celda y no suelta el punto de la vecina', async () => {
      const idVecina = await crearHistorica(bruno.id, 'Atole de la vecina', VECINA);
      try {
        const r = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 3 }));
        esperar(r.status === 200, `HTTP ${r.status}`);
        const celda = r.body.cells.find((c) => c.x === Math.round(EXACTA.lng * 1000) && c.y === Math.round(EXACTA.lat * 1000));
        esperar(celda && celda.count === 2 && !celda.punto, `celda compartida: ${JSON.stringify(celda)}`);
        sinCoordenadas(JSON.stringify(r.body), VECINA, 'celda compartida');
        return `celda ${celda.x},${celda.y} con ${celda.count} publicaciones y sin punto`;
      } finally {
        await sql(cfg.ref, `delete from public.products_services where id = ${q(idVecina)}`);
      }
    });

    await caso('sin sesion no se ejecutan v4 ni la lectura del dueno', async () => {
      const a = await rpc(cfg, null, 'search_map_publications_v4', peticion('overview'));
      const b = await rpc(cfg, null, 'ubicacion_de_mi_publicacion', { p_product_id: idExacta });
      esperar((a.status === 401 || a.status === 403) && (b.status === 401 || b.status === 403), `HTTP ${a.status} y ${b.status}`);
      return `HTTP ${a.status} y ${b.status}`;
    });

    await caso('la funcion de la ficha y el minimapa solo la ejecuta service_role', async () => {
      const cliente = await rpc(cfg, visitante.token, 'ubicacion_publica_de_publicacion', { p_product_id: idExacta, p_decimales: 3 });
      esperar(cliente.status >= 400, `visitante: HTTP ${cliente.status}`);
      const servidor = await rpc(cfg, cfg.service, 'ubicacion_publica_de_publicacion', { p_product_id: idExacta, p_decimales: 3 });
      esperar(servidor.status === 200, `service_role: HTTP ${servidor.status} ${JSON.stringify(servidor.body)}`);
      esperar(servidor.body.precision === 'exacta' && servidor.body.lat === EXACTA.lat && servidor.body.lng === EXACTA.lng, JSON.stringify(servidor.body));
      const aprox = await rpc(cfg, cfg.service, 'ubicacion_publica_de_publicacion', { p_product_id: idHistorica, p_decimales: 3 });
      esperar(aprox.body.precision === 'aproximada' && aprox.body.lat === Math.round(HISTORICA.lat * 1000) / 1000, JSON.stringify(aprox.body));
      return `visitante HTTP ${cliente.status}; exacta ${servidor.body.lat},${servidor.body.lng}; aproximada ${aprox.body.lat},${aprox.body.lng}`;
    });

    await caso('el dueno recupera su punto y su modo para editar; otra cuenta recibe null', async () => {
      const propio = await rpc(cfg, ana.token, 'ubicacion_de_mi_publicacion', { p_product_id: idExacta });
      esperar(propio.status === 200 && propio.body?.precision === 'exacta' && propio.body?.lat === EXACTA.lat, JSON.stringify(propio.body));
      const ajeno = await rpc(cfg, visitante.token, 'ubicacion_de_mi_publicacion', { p_product_id: idExacta });
      esperar(ajeno.status === 200 && ajeno.body === null, `ajeno: HTTP ${ajeno.status} ${JSON.stringify(ajeno.body)}`);
    });

    let revisionMapa = null;
    await caso('editar el precio no cambia el modo ni la revision', async () => {
      const vista = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('check', { rejilla: 3 }));
      revisionMapa = vista.body?.revision ?? null;
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { precio: 45 } });
      esperar(r.status < 300, `PATCH precio: HTTP ${r.status}`);
      const f = await fila(idExacta);
      esperar(f.precio === 45 && f.precision === 'exacta' && f.revision === 0, JSON.stringify(f));
      return `revision ${f.revision}`;
    });

    await caso('mover el punto exacto sube la revision y el punto publico lo sigue', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_geo: ewkt(MOVIDA), ubicacion_precision: 'exacta' } });
      esperar(r.status < 300, `HTTP ${r.status}`);
      const f = await fila(idExacta);
      esperar(f.revision === 1 && f.exacta === `POINT(${MOVIDA.lng} ${MOVIDA.lat})`, JSON.stringify(f));
      const mapa = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 3 }));
      sinCoordenadas(JSON.stringify(mapa.body), EXACTA, 'v4 tras mover');
      return `revision ${f.revision}`;
    });

    await caso('pasar a aproximada revoca el punto exacto, sube la revision y cambia la del mapa', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_precision: 'aproximada' } });
      esperar(r.status < 300, `HTTP ${r.status}`);
      const f = await fila(idExacta);
      esperar(f.precision === 'aproximada' && f.exacta === null && f.revision === 2, JSON.stringify(f));
      const mapa = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('check', { rejilla: 3 }));
      esperar(mapa.body.revision !== revisionMapa, 'la revision del mapa no cambio');
      const celdas = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 3 }));
      sinCoordenadas(JSON.stringify(celdas.body), MOVIDA, 'v4 tras revocar');
      esperar(!celdas.body.cells.some((c) => c.punto), 'quedo una celda con punto exacto');
      const ficha = await rpc(cfg, cfg.service, 'ubicacion_publica_de_publicacion', { p_product_id: idExacta, p_decimales: 3 });
      esperar(ficha.body.precision === 'aproximada' && ficha.body.revision === 2 && ficha.body.lat === Math.round(MOVIDA.lat * 1000) / 1000, JSON.stringify(ficha.body));
      return `revision ${f.revision}; ficha ${ficha.body.lat},${ficha.body.lng}`;
    });

    await caso('quitar la ubicacion deja la publicacion aproximada y sin punto', async () => {
      await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_precision: 'exacta', ubicacion_geo: ewkt(EXACTA) } });
      const antes = await fila(idExacta);
      esperar(antes.precision === 'exacta', `antes ${JSON.stringify(antes)}`);
      const r = await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_geo: null, ubicacion: null } });
      esperar(r.status < 300, `HTTP ${r.status}`);
      const f = await fila(idExacta);
      esperar(f.precision === 'aproximada' && f.exacta === null && f.geo === null, JSON.stringify(f));
      await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_geo: ewkt(EXACTA), ubicacion_precision: 'exacta' } });
    });

    await caso('un bloqueo oculta la exacta en v4 (mismo filtro que v3)', async () => {
      await bloquear(cfg, ana.id, bloqueado.id);
      const r = await rpc(cfg, bloqueado.token, 'search_map_publications_v4', peticion('cells', { rejilla: 3 }));
      esperar(r.status === 200, `HTTP ${r.status}`);
      sinCoordenadas(JSON.stringify(r.body), EXACTA, 'v4 para el bloqueado');
      const otro = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 3 }));
      esperar(JSON.stringify(otro.body).includes(String(EXACTA.lat)), 'el visitante sin bloqueo deberia verla');
    });

    await caso('con rejilla 2 y sin exactas, v4 ve lo mismo que v2 (las historicas no cambian)', async () => {
      await http(cfg, 'PATCH', `/rest/v1/products_services?id=eq.${idExacta}`, { token: ana.token, body: { ubicacion_precision: 'aproximada' } });
      const v2 = await rpc(cfg, visitante.token, 'search_map_publications_v2', peticion('cells'));
      const v4 = await rpc(cfg, visitante.token, 'search_map_publications_v4', peticion('cells', { rejilla: 2 }));
      esperar(v2.status === 200 && v4.status === 200, `HTTP ${v2.status} y ${v4.status}`);
      const v2a = v2.body.cells.map((c) => `${c.x * 10}:${c.y * 10}:${c.count}`).sort().join(',');
      const v4a = v4.body.cells.map((c) => `${c.x}:${c.y}:${c.count}`).sort().join(',');
      esperar(v2a === v4a && v2.body.total === v4.body.total, `v2 ${v2a} | v4 ${v4a}`);
      return `${v4.body.total} publicaciones, ${v4.body.cells.length} celdas`;
    });
  } finally {
    await sql(cfg.ref, `delete from public.user_blocks where blocker_id = ${q(ana.id)}`).catch(() => {});
    await sql(cfg.ref, `delete from public.products_services where id in ${mios}`).catch(() => {});
    await limpiar(cfg);
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallos}/${resultados.length} casos en verde`);
  process.exit(fallos ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
