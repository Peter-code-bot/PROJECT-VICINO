#!/usr/bin/env node
/**
 * S05-cuenta-sintetica (plan en docs/planes-2026-09-26/S05-cuenta-sintetica.md):
 * con una cuenta sintetica y SOLO por la UI real (web local :3100 -> staging):
 *
 *   1. Publicar un producto con ubicacion en Villahermosa guarda ubicacion_geo
 *      correcta y dentro de la cobertura, y la ficha publica no filtra el punto.
 *   2. Editarlo moviendo el pin SUSTITUYE el punto (sigue habiendo 1 fila).
 *   3. Crear una Solicitud con ubicacion (INSERT directo del navegador a
 *      PostgREST) guarda su punto y respeta el trigger de cobertura.
 *   4. Negativos en Guatemala: aviso en la UI sin fila nueva, y el INSERT
 *      directo por REST da 400 con code 22023.
 *
 *   node scripts/staging/e2e-ubicacion-publicar.mjs   (web local :3100 contra staging)
 *
 * MapKit no carga en local: el proveedor se sustituye por el de
 * ./mapkit-falso.mjs. Esto acredita la cadena UI -> accion/PostgREST -> base ->
 * trigger; NO acredita MapKit real, la pinza ni el tacto en iPhone/iPad
 * (sigue pendiente en D01-S05 con dispositivo).
 *
 * Fixtures sinteticos (@staging.vicino.test, '[FIXTURE]'); se retiran al final.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR, sql, prodRead, sleep } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, rpc, http, limpiar } from './fixtures.mjs';
import { instalarMapkitFalso } from './mapkit-falso.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const VILLAHERMOSA = { lat: 17.9892, lng: -92.9281 };
const VILLAHERMOSA_PIN = { lat: 18.0021, lng: -92.9447 };
const MERIDA = { lat: 20.9674, lng: -89.5926 };
const GUATEMALA = { lat: 14.6349, lng: -90.5069 };
const TOLERANCIA = 1e-5;
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) <= TOLERANCIA;
const fmt = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

/** next dev se reinicia a veces por memoria: se reintenta la conexion, no la prueba. */
const ir = async (page, ruta) => {
  const hasta = Date.now() + 240_000;
  for (;;) {
    try { return await page.goto(`${BASE}${ruta}`, { timeout: 180_000 }); }
    catch (e) {
      const caida = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ECONNREFUSED/.test(e.message);
      if (!caida || Date.now() > hasta) throw e;
      await sleep(5_000);
    }
  }
};

const login = async (page, u) => {
  await ir(page, '/login');
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

/** Espera activa con el ultimo valor visto en el error. */
const esperar = async (leer, ok, ms, que) => {
  const hasta = Date.now() + ms;
  let ultimo;
  while (Date.now() < hasta) {
    ultimo = await leer();
    if (ok(ultimo)) return ultimo;
    await sleep(250);
  }
  throw new Error(`${que}: ultimo valor ${JSON.stringify(ultimo)}`);
};

/**
 * El input del buscador nace deshabilitado y se habilita cuando MapKit (el
 * falso) esta listo, lo que ademas exige la hidratacion: es la marca para no
 * perder clics antes de hidratar.
 */
const buscadorListo = async (raiz) => {
  const input = raiz.getByPlaceholder('Busca tu zona de entrega…');
  await input.waitFor({ timeout: 120_000 });
  await esperar(() => input.isEnabled(), Boolean, 60_000, 'el buscador de ubicacion no se habilito (MapKit falso sin cargar)');
  return input;
};

/** Escribe la consulta, espera la sugerencia y la elige. */
const elegirZona = async (raiz, consulta, patron) => {
  const input = await buscadorListo(raiz);
  await input.fill(consulta);
  const sugerencia = raiz.getByRole('button', { name: patron }).first();
  await sugerencia.waitFor({ timeout: 20_000 });
  await sugerencia.click();
};

const pinDelMapa = (page) => page.evaluate(() => window.__mk?.pin?.() ?? null);

const filaProducto = async (creadorId) => sql(
  cfg.ref,
  `select id, slug, titulo, ubicacion,
          ST_Y(ubicacion_geo::geometry) as lat, ST_X(ubicacion_geo::geometry) as lng,
          public.dentro_de_cobertura(ST_Y(ubicacion_geo::geometry), ST_X(ubicacion_geo::geometry)) as dentro
     from public.products_services where creador_id = ${q(creadorId)} order by created_at`
);

const filasSolicitud = async (buyerId) => sql(
  cfg.ref,
  `select r.id, r.title, r.status,
          ST_Y(r.ubicacion_geo::geometry) as lat, ST_X(r.ubicacion_geo::geometry) as lng,
          public.dentro_de_cobertura(ST_Y(r.ubicacion_geo::geometry), ST_X(r.ubicacion_geo::geometry)) as dentro,
          (select count(*) from public.purchase_request_categories c where c.request_id = r.id) as categorias
     from public.purchase_requests r where r.buyer_id = ${q(buyerId)} order by r.created_at`
);

const errorDelFormulario = async (page) => {
  const banner = page.locator('form').getByText('⚠️').first();
  return (await banner.isVisible().catch(() => false)) ? (await banner.locator('..').innerText()).trim() : null;
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const marca = crypto.randomBytes(3).toString('hex');
  const TIT_PRODUCTO = `[FIXTURE] S05 publicar Villahermosa ${marca}`;
  const TIT_SOLICITUD = `[FIXTURE] S05 solicitud Mérida ${marca}`;
  const TIT_NEGATIVO = `[FIXTURE] S05 negativo Guatemala ${marca}`;

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  let producto = null;
  let usuario = null;
  try {
    await paso('precondicion: cobertura "pais" en staging igual que prod, funcion y triggers', async () => {
      const lectura = 'select modo from public.vicino_cobertura where clave = \'operacion\'';
      const [st] = await sql(cfg.ref, lectura);
      const [pr] = await prodRead(lectura);
      exigir(st, 'staging sin fila de cobertura: dentro_de_cobertura() daria true a todo y la prueba no valdria');
      exigir(st.modo === 'pais' && pr?.modo === 'pais', `staging=${st.modo}, prod=${pr?.modo}`);
      const [f] = await sql(
        cfg.ref,
        `select public.dentro_de_cobertura(${VILLAHERMOSA.lat}, ${VILLAHERMOSA.lng}) as vh,
                public.dentro_de_cobertura(${GUATEMALA.lat}, ${GUATEMALA.lng}) as gt,
                (select count(*) from pg_trigger where not tgisinternal and tgname in
                   ('exigir_cobertura_products_services', 'exigir_cobertura_purchase_requests')) as triggers`
      );
      exigir(f.vh === true && f.gt === false, `dentro_de_cobertura: Villahermosa=${f.vh}, Guatemala=${f.gt}`);
      exigir(Number(f.triggers) === 2, `triggers exigir_cobertura_*: ${f.triggers}/2`);
      return 'pais/pais, Villahermosa dentro, Guatemala fuera, 2 triggers';
    });

    usuario = await crearUsuario(cfg, 's05-ubicacion');
    await completarOnboarding(cfg, usuario.id);
    await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(usuario.id)}`);

    await paso('precondicion: storage de staging acepta subir y borrar en product-media (token sintetico)', async () => {
      const [b] = await sql(cfg.ref, `select count(*) as n from storage.buckets where id = 'product-media'`);
      exigir(Number(b.n) === 1, 'no existe el bucket product-media');
      const ruta = `${cfg.url}/storage/v1/object/product-media/${usuario.id}/s05-probe.png`;
      const cab = { apikey: cfg.anon, Authorization: `Bearer ${usuario.token}` };
      const sube = await fetch(ruta, { method: 'POST', headers: { ...cab, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: PNG_1X1 });
      const borra = await fetch(`${cfg.url}/storage/v1/object/product-media`, {
        method: 'DELETE', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`${usuario.id}/s05-probe.png`] }),
      });
      const [resto] = await sql(cfg.ref, `select count(*) as n from storage.objects where bucket_id = 'product-media' and name = ${q(`${usuario.id}/s05-probe.png`)}`);
      exigir(sube.status === 200 && borra.status === 200 && Number(resto.n) === 0,
        `subida ${sube.status}, borrado ${borra.status}, objetos que quedan ${resto.n}`);
      return `subida ${sube.status} / borrado ${borra.status}`;
    });

    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX', serviceWorkers: 'block',
    });
    await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent(`${PUEBLA.lat},${PUEBLA.lng}`), url: BASE }]);
    const cuentasMapkit = await instalarMapkitFalso(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));

    await paso('login real del vendedor sintetico', () => login(page, usuario));

    await paso('publicar por la UI con ubicacion en Villahermosa: redirige a la ficha sin error', async () => {
      await ir(page, '/vender');
      await buscadorListo(page);
      await page.locator('#titulo').fill(TIT_PRODUCTO);
      await page.locator('#precio').fill('150');
      await page.locator('#descripcion').fill('Producto sintetico de la prueba S05 con ubicacion.');
      await page.locator('#estado').selectOption('nuevo');
      await page.getByRole('button', { name: 'Selecciona una categoría' }).click();
      await page.getByRole('button', { name: /^Libros y Papelería/ }).click();
      await page.getByRole('button', { name: 'Libros y Papelería es la principal' }).waitFor({ timeout: 10_000 });
      await elegirZona(page, 'Villahermosa', /Villahermosa.*Tabasco/);
      await esperar(() => page.locator('input[name="ubicacion_lat"]').inputValue(), (v) => cerca(v, VILLAHERMOSA.lat), 10_000, 'ubicacion_lat del formulario');
      // El mapa llega por next/dynamic: se espera a que pinte el marcador.
      await esperar(() => pinDelMapa(page), (p) => p && cerca(p[0], VILLAHERMOSA.lat) && cerca(p[1], VILLAHERMOSA.lng), 30_000, 'pin de Villahermosa en el mapa');
      await page.getByRole('button', { name: 'Publicar', exact: true }).click();
      await page.waitForURL((u) => /^\/libros\/[^/]+$/.test(u.pathname), { timeout: 90_000 }).catch(async () => {
        throw new Error(`no redirigio a la ficha (sigue en ${new URL(page.url()).pathname}; error: ${await errorDelFormulario(page)})`);
      });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      // La ficha pinta el titulo en el layout movil y en el de escritorio (uno oculto).
      await page.getByText(TIT_PRODUCTO).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
      await page.screenshot({ path: path.join(OUT, 's05-publicar-ficha.png') });
      const c = cuentasMapkit();
      exigir(c.token > 0 && c.script > 0, `la pagina no paso por el MapKit falso (${JSON.stringify(c)})`);
      return new URL(page.url()).pathname;
    });

    await paso('base tras publicar: 1 fila, punto de Villahermosa, dentro de cobertura y nombre de la sugerencia', async () => {
      const filas = await filaProducto(usuario.id);
      exigir(filas.length === 1, `${filas.length} filas del vendedor`);
      [producto] = filas;
      exigir(producto.titulo === TIT_PRODUCTO, `titulo ${producto.titulo}`);
      exigir(cerca(producto.lat, VILLAHERMOSA.lat) && cerca(producto.lng, VILLAHERMOSA.lng), `punto ${fmt(producto.lat, producto.lng)}`);
      exigir(producto.dentro === true, 'dentro_de_cobertura = false');
      exigir(producto.ubicacion === 'Villahermosa, Tabasco, México', `ubicacion "${producto.ubicacion}"`);
      return `${fmt(producto.lat, producto.lng)} "${producto.ubicacion}"`;
    });

    await paso('privacidad: la ficha publica (visitante y dueno) no lleva las coordenadas crudas', async () => {
      exigir(producto, 'no hay producto');
      const ruta = new URL(page.url()).pathname;
      const res = await fetch(`${BASE}${ruta}`);
      const visitante = await res.text();
      exigir(res.status === 200 && visitante.includes(TIT_PRODUCTO), `visitante: HTTP ${res.status}, titulo ${visitante.includes(TIT_PRODUCTO)}`);
      const dueno = await page.content();
      for (const [quien, html] of [['visitante', visitante], ['dueno', dueno]]) {
        for (const crudo of ['17.9892', '-92.9281']) exigir(!html.includes(crudo), `${quien}: el HTML contiene ${crudo}`);
      }
      return `${ruta} sin 17.9892 ni -92.9281`;
    });

    let ubicacionEditada = null;
    await paso('editar por la UI: el mapa abre con el pin guardado, tocar mueve el pin y Guardar vuelve a /seller/listings', async () => {
      exigir(producto, 'no hay producto');
      await ir(page, `/vender/${producto.id}/editar`);
      await buscadorListo(page);
      const inicial = await esperar(() => pinDelMapa(page), (p) => Array.isArray(p), 30_000, 'pin inicial del mapa');
      exigir(cerca(inicial[0], VILLAHERMOSA.lat) && cerca(inicial[1], VILLAHERMOSA.lng), `pin inicial ${fmt(...inicial)} (get_product_location)`);
      await page.evaluate(([lat, lng]) => window.__mk.tocar(lat, lng), [VILLAHERMOSA_PIN.lat, VILLAHERMOSA_PIN.lng]);
      await esperar(() => pinDelMapa(page), (p) => p && cerca(p[0], VILLAHERMOSA_PIN.lat) && cerca(p[1], VILLAHERMOSA_PIN.lng), 10_000, 'pin movido');
      // La inversa llega a los 800 ms: hasta entonces la direccion es el
      // provisional "lat, lng" y eso NO es lo que se quiere guardar.
      const provisional = `${VILLAHERMOSA_PIN.lat.toFixed(4)}, ${VILLAHERMOSA_PIN.lng.toFixed(4)}`;
      ubicacionEditada = await esperar(
        () => page.locator('input[name="ubicacion"]').inputValue(),
        (v) => v && v !== provisional && v.includes('Tabasco 2000'), 15_000, 'direccion de la geocodificacion inversa'
      );
      exigir(cerca(await page.locator('input[name="ubicacion_lat"]').inputValue(), VILLAHERMOSA_PIN.lat), 'ubicacion_lat del formulario no es el pin nuevo');
      await page.screenshot({ path: path.join(OUT, 's05-editar-pin.png') });
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.waitForURL((u) => u.pathname === '/seller/listings', { timeout: 90_000 }).catch(async () => {
        throw new Error(`no volvio a /seller/listings (sigue en ${new URL(page.url()).pathname}; error: ${await errorDelFormulario(page)})`);
      });
      return `pin ${fmt(...inicial)} -> ${fmt(VILLAHERMOSA_PIN.lat, VILLAHERMOSA_PIN.lng)}, "${ubicacionEditada}"`;
    });

    await paso('base tras editar: sigue 1 fila, el punto nuevo sustituye al anterior, nombre de la inversa, get_product_location', async () => {
      exigir(producto, 'no hay producto');
      const filas = await filaProducto(usuario.id);
      exigir(filas.length === 1, `${filas.length} filas del vendedor (el pin no debe duplicar la publicacion)`);
      const [f] = filas;
      exigir(f.id === producto.id, 'la fila cambio de id');
      exigir(cerca(f.lat, VILLAHERMOSA_PIN.lat) && cerca(f.lng, VILLAHERMOSA_PIN.lng), `punto ${fmt(f.lat, f.lng)}`);
      exigir(!cerca(f.lat, producto.lat) || !cerca(f.lng, producto.lng), 'el punto no cambio');
      exigir(f.dentro === true, 'dentro_de_cobertura = false');
      exigir(f.ubicacion === ubicacionEditada, `ubicacion "${f.ubicacion}" (UI "${ubicacionEditada}")`);
      const r = await rpc(cfg, usuario.token, 'get_product_location', { p_product_id: producto.id });
      const c = Array.isArray(r.body) ? r.body[0] : null;
      exigir(r.status === 200 && c && cerca(c.lat, VILLAHERMOSA_PIN.lat) && cerca(c.lng, VILLAHERMOSA_PIN.lng),
        `get_product_location: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      return `${fmt(producto.lat, producto.lng)} -> ${fmt(f.lat, f.lng)}, "${f.ubicacion}"`;
    });

    const dialogo = page.getByRole('dialog', { name: 'Nueva solicitud' });
    const abrirDrawer = async () => {
      await ir(page, '/?feed=solicitudes');
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      const fab = page.getByRole('button', { name: 'Crear solicitud' });
      await fab.waitFor({ timeout: 60_000 });
      // Un clic antes de hidratar se pierde en silencio: se reintenta hasta ver el drawer.
      for (let i = 0; i < 6 && !(await dialogo.isVisible().catch(() => false)); i++) {
        await fab.click();
        await dialogo.waitFor({ timeout: 3_000 }).catch(() => {});
      }
      await dialogo.waitFor({ timeout: 5_000 });
    };
    const rellenarSolicitud = async (titulo) => {
      await dialogo.getByPlaceholder('Ej: Busco técnico para lavadora').fill(titulo);
      await dialogo.getByRole('button', { name: 'Selecciona una categoría' }).click();
      await dialogo.getByRole('button', { name: /^Herramientas/ }).click();
      await dialogo.getByRole('button', { name: 'Quitar Herramientas' }).waitFor({ timeout: 10_000 });
      await elegirZona(dialogo, 'Mérida', /Mérida.*Yucatán/);
      await esperar(() => pinDelMapa(page), (p) => p && cerca(p[0], MERIDA.lat) && cerca(p[1], MERIDA.lng), 10_000, 'pin de Merida en el mapa del drawer');
    };

    await paso('crear una Solicitud por la UI con ubicacion en Merida: el drawer se cierra', async () => {
      await abrirDrawer();
      await rellenarSolicitud(TIT_SOLICITUD);
      await dialogo.getByRole('button', { name: 'Publicar solicitud' }).click();
      await dialogo.waitFor({ state: 'detached', timeout: 30_000 }).catch(async () => {
        const txt = await dialogo.locator('p.text-destructive').innerText().catch(() => '(sin mensaje)');
        throw new Error(`el drawer no se cerro: ${txt}`);
      });
      await page.screenshot({ path: path.join(OUT, 's05-solicitud-creada.png') });
    });

    await paso('base tras la solicitud: 1 open, punto de Merida, dentro de cobertura y con categoria', async () => {
      const filas = await filasSolicitud(usuario.id);
      exigir(filas.length === 1, `${filas.length} solicitudes del comprador`);
      const [s] = filas;
      exigir(s.title === TIT_SOLICITUD, `titulo ${s.title}`);
      exigir(s.status === 'open', `status ${s.status}`);
      exigir(cerca(s.lat, MERIDA.lat) && cerca(s.lng, MERIDA.lng), `punto ${fmt(s.lat, s.lng)}`);
      exigir(s.dentro === true, 'dentro_de_cobertura = false');
      exigir(Number(s.categorias) >= 1, `${s.categorias} categorias`);
      return `${fmt(s.lat, s.lng)}, ${s.categorias} categoria(s)`;
    });

    await paso('negativo UI: pin en Guatemala -> aviso de fuera de zona y ninguna fila nueva', async () => {
      await abrirDrawer();
      await rellenarSolicitud(TIT_NEGATIVO);
      await page.evaluate(([lat, lng]) => window.__mk.tocar(lat, lng), [GUATEMALA.lat, GUATEMALA.lng]);
      await page.waitForTimeout(1_200);
      // El picker solo mira la caja de Mexico, que mete dentro a la Ciudad de
      // Guatemala (lo dice la propia migracion 20260913160000): el aviso llega
      // del trigger al publicar (22023 traducido por el drawer). Si algun dia el
      // picker lo rechaza antes, tambien vale: se anota cual de los dos fue.
      const avisoPicker = dialogo.getByText('Ese punto está fuera de la cobertura de VICINO', { exact: false });
      let via;
      if (await avisoPicker.isVisible().catch(() => false)) {
        via = 'aviso del picker';
      } else {
        const pin = await pinDelMapa(page);
        exigir(pin && cerca(pin[0], GUATEMALA.lat), `el pin no se movio a Guatemala (${JSON.stringify(pin)})`);
        await dialogo.getByRole('button', { name: 'Publicar solicitud' }).click();
        await dialogo.getByText('Esa ubicación está fuera de la zona donde VICINO opera').waitFor({ timeout: 20_000 });
        via = '22023 del trigger traducido por el drawer';
      }
      exigir(await dialogo.isVisible(), 'el drawer se cerro');
      await page.screenshot({ path: path.join(OUT, 's05-negativo-guatemala.png') });
      const filas = await filasSolicitud(usuario.id);
      exigir(filas.length === 1, `${filas.length} solicitudes (debia seguir 1)`);
      exigir(!filas.some((f) => f.title === TIT_NEGATIVO), 'se guardo la solicitud de Guatemala');
      return via;
    });

    await paso('negativo API: INSERT directo en Guatemala con el token del usuario -> 400, code 22023', async () => {
      const r = await http(cfg, 'POST', '/rest/v1/purchase_requests', {
        token: usuario.token,
        prefer: 'return=minimal',
        body: {
          buyer_id: usuario.id,
          title: `[FIXTURE] S05 API Guatemala ${marca}`,
          expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
          ubicacion_geo: `SRID=4326;POINT(${GUATEMALA.lng} ${GUATEMALA.lat})`,
        },
      });
      exigir(r.status === 400 && r.body?.code === '22023', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      const filas = await filasSolicitud(usuario.id);
      exigir(filas.length === 1, `${filas.length} solicitudes (debia seguir 1)`);
      return `${r.status} ${r.body.code}`;
    });

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
    const n = await limpiar(cfg);
    const [resto] = await sql(
      cfg.ref,
      `select (select count(*) from public.products_services where titulo like '[FIXTURE] S05%')
            + (select count(*) from public.purchase_requests where title like '[FIXTURE] S05%') as n`
    );
    const s05 = Number(resto.n);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}. Filas S05 restantes: ${s05}.`);
    process.exitCode = ok === resultados.length && n === 0 && s05 === 0 ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
