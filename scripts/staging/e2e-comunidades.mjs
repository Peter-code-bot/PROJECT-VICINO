#!/usr/bin/env node
/**
 * S07-comunidades-funcional: fundar y administrar comunidades con la web local
 * (:3100) contra el staging, y contraste con los arreglos del 16-sep
 * (20260916140000_comunidades_sin_limites_y_con_imagenes.sql).
 *
 *   node scripts/staging/e2e-comunidades.mjs
 *
 * Reglas que se prueban, TODAS leidas del codigo (ninguna inventada):
 *   - fundar_comunidad: nombre 3-40 tras btrim, descripcion <= 300, lat/lng en
 *     rango, sesion (anon no tiene EXECUTE), cuenta no suspendida.
 *   - CUOTA A: 3 comunidades vivas por fundador (comunidad_fundacion_estado).
 *   - CUOTA B (una cada 24 h): ELIMINADA el 16-sep; fundar dos seguidas vale.
 *   - CUOTA C: 1 km entre las comunidades propias vivas (inline en fundar).
 *   - uq_communities_celda_nombre: mismo nombre en la misma celda -> 23505.
 *   - Mando: solo el owner edita descripcion/visibilidad/centro y nombra
 *     moderadores; authenticated no tiene INSERT/UPDATE/DELETE en las tablas.
 *   - 16-sep: «Archivar» fuera del panel de administrar.
 *
 * Lo que NO cubre: CUOTA D (20 membresias; montarla exige 20 comunidades),
 * mover el centro sin limite, imagenes en publicaciones, MapKit real.
 *
 * Todas las comunidades se llaman «[FIXTURE] ...» y las funda un usuario
 * @staging.vicino.test; limpiar() las retira (owner_id/fundador_id son
 * ON DELETE SET NULL: sin borrarlas quedarian huerfanas y vivas).
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, suspender, rpc, http, leer, limpiar } from './fixtures.mjs';
import { instalarMapkitFalso, LUGARES } from './mapkit-falso.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
// Otro punto a mas de 1 km de PUEBLA (para la CUOTA C) y un tercero.
const NORTE = { lat: 19.1, lng: -98.2 };
const PONIENTE = { lat: 18.98, lng: -98.3 };
const SUR = { lat: 18.9, lng: -98.1 };
const UUID_RE = /\/comunidades\/([0-9a-f-]{36})$/;
const cfg = staging();
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };

/**
 * page.goto con reintento SOLO si el servidor no contesta: el dev server de
 * :3100 se reinicia solo al pasar un umbral de memoria (ERR_CONNECTION_*), y
 * eso no es un fallo de la app. Cualquier otro error sale tal cual.
 */
const SIN_SERVIDOR = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/;
const irA = async (page, url) => {
  let colgadas = 0;
  for (let i = 0; ; i++) {
    try { return await page.goto(url, { timeout: 120_000 }); }
    catch (e) {
      // Un goto que no termina en 2 min (servidor colgado) se repite hasta DOS veces.
      const colgado = /Timeout \d+ms exceeded/.test(e.message) && colgadas++ < 2;
      if (i >= 9 || !(SIN_SERVIDOR.test(e.message) || colgado)) throw e;
      await page.waitForTimeout(10_000);
    }
  }
};

const login = async (page, u) => {
  await irA(page, `${BASE}/login`);
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

const contexto = async (browser, { cookie = true, lugares = LUGARES } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  if (cookie) await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent(`${PUEBLA.lat},${PUEBLA.lng}`), url: BASE }]);
  const cuentas = await instalarMapkitFalso(ctx, { lugares });
  return { ctx, cuentas };
};

// ─── Evidencia en la base (como postgres: el cliente no la puede falsear) ───

/** Comunidades y membresias de los fixtures, y el total global de comunidades. */
const conteo = async (ids) => {
  const lista = ids.map(q).join(', ');
  const [r] = await leer(cfg, `select
      (select count(*) from public.communities) as total,
      (select count(*) from public.communities where fundador_id in (${lista}) or owner_id in (${lista})) as comunidades,
      (select count(*) from public.community_members where user_id in (${lista})) as membresias,
      (select count(*) from public.community_post_quota where user_id in (${lista})) as ledger`);
  return { total: Number(r.total), comunidades: Number(r.comunidades), membresias: Number(r.membresias), ledger: Number(r.ledger) };
};
const mismoConteo = (antes, ahora, que) => {
  for (const k of Object.keys(antes)) {
    if (antes[k] !== ahora[k]) throw new Error(`${que}: ${k} ${antes[k]} -> ${ahora[k]}`);
  }
  return `sin filas nuevas (${JSON.stringify(ahora)})`;
};
const comunidad = async (id) => {
  const [c] = await leer(cfg, `select id, nombre, descripcion, owner_id, fundador_id, es_privada, is_hidden,
      archived_at, miembros_count, celda, round(st_y(centro::geometry)::numeric, 2)::float as lat,
      round(st_x(centro::geometry)::numeric, 2)::float as lng, created_at
    from public.communities where id = ${q(id)}`);
  return c ?? null;
};
const miembros = (id) =>
  leer(cfg, `select user_id, role, left_at from public.community_members where community_id = ${q(id)} order by joined_at`);


/**
 * Ruta final tras las redirecciones. OJO: /comunidades/[id]/administrar tiene
 * loading.tsx, asi que el redirect() de la pagina llega DENTRO del stream (200
 * + NEXT_REDIRECT + meta refresh) y el cambio de URL es del cliente, despues
 * de page.goto. Se espera a que la URL deje de moverse.
 */
/** Un redirect() dentro del stream deja un <meta http-equiv="refresh"> hasta que el cliente navega. */
const redireccionPendiente = (page) =>
  page.evaluate(() => !!document.querySelector('meta[http-equiv="refresh"]')).catch(() => false);
const rutaFinal = async (page, url) => {
  await irA(page, url);
  let ultima = page.url();
  let quieta = Date.now();
  const tope = Date.now() + 45_000;
  while (Date.now() < tope && Date.now() - quieta < 2_500) {
    await page.waitForTimeout(250);
    if (page.url() !== ultima) { ultima = page.url(); quieta = Date.now(); }
    // Mientras quede el meta refresh del redirect en stream, la URL aun no es la final.
    if (Date.now() - quieta >= 2_500 && (await redireccionPendiente(page))) quieta = Date.now() - 1_500;
  }
  return new URL(page.url()).pathname;
};

// ─── UI ─────────────────────────────────────────────────────────────────────

const irAComunidades = async (page) => {
  await irA(page, `${BASE}/?feed=comunidades&tab=mias`);
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
};
/** El FAB de fundar (fixed, h-14): su aria-label cambia con la cuota. */
const fab = (page) => page.locator('button.fixed.h-14[aria-label]');
const dialogo = (page) => page.getByRole('dialog', { name: 'Fundar comunidad' });

/**
 * Abre el drawer desde el FAB. Reintenta el clic (uno antes de hidratar se
 * pierde) y, si el FAB no sale, recarga: con el dev server recompilando por
 * ediciones de otra sesion, la primera carga a veces no llega a pintarlo.
 */
const abrirFundar = async (page) => {
  const boton = page.locator('button[aria-label="Fundar comunidad"]');
  const dlg = dialogo(page);
  for (let intento = 0; intento < 3; intento++) {
    if (await boton.waitFor({ timeout: 45_000 }).then(() => true, () => false)) {
      for (let i = 0; i < 6 && !(await dlg.isVisible().catch(() => false)); i++) {
        await boton.click().catch(() => {});
        await dlg.waitFor({ timeout: 3_000 }).catch(() => {});
      }
      if (await dlg.isVisible().catch(() => false)) return dlg;
    }
    await page.screenshot({ path: path.join(OUT, `comunidades-sin-fab-${intento}.png`) }).catch(() => {});
    await irA(page, page.url());
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  }
  const texto = (await page.locator('body').innerText().catch(() => '')).replace(/s+/g, ' ').slice(0, 160);
  throw new Error(`no se abrio el drawer en ${new URL(page.url()).pathname}: «${texto}»`);
};
/** Un paso que depende de filas de pasos anteriores no corre sin ellas: podria crear filas de verdad. */
const requiere = (...xs) => {
  if (xs.some((x) => !x)) throw new Error('precondicion: fallo un paso anterior (comunidad o sesion de B); no se ejecuta para no crear filas');
};
const enviar = (dlg) => dlg.getByRole('button', { name: 'Fundar comunidad', exact: true });
const errorDelDrawer = (dlg) => dlg.locator('p.text-destructive');
/** El mapa del selector (MapKit falso) listo para recibir un toque. */
const esperarMapa = (page) => page.waitForFunction(() => !!window.__mk?.mapa?.(), null, { timeout: 30_000 });

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const marca = crypto.randomBytes(3).toString('hex');
  const nombre1 = `[FIXTURE] Vecinos ${marca}`;
  const nombre2 = `[FIXTURE] Privada ${marca}`;
  const A = await crearUsuario(cfg, 'com-fundador');
  await completarOnboarding(cfg, A.id);
  const B = await crearUsuario(cfg, 'com-intruso');
  await completarOnboarding(cfg, B.id);
  const ids = [A.id, B.id];
  let id1 = null;
  let id2 = null;
  let id3 = null;
  let bDentro = false;
  let bUnido = false;

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  try {
    await paso('RPC: estado_cuota_fundacion de un usuario nuevo (A: 0/3, sin cuenta atras de 24 h)', async () => {
      const r = await rpc(cfg, A.token, 'estado_cuota_fundacion', {});
      exigir(r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
      const e = r.body;
      exigir(e.puede_fundar === true && e.fundadas_vivas === 0 && e.tope_vivas === 3 && e.siguiente_en === null, JSON.stringify(e));
      return JSON.stringify(e);
    });

    await paso('RPC: datos invalidos y visitante se rechazan con su codigo y no crean nada', async () => {
      const antes = await conteo(ids);
      const casos = [
        ['nombre de 2', A.token, { p_nombre: 'ab', p_lat: PUEBLA.lat, p_lng: PUEBLA.lng }, '22023', /entre 3 y 40/],
        ['nombre de espacios', A.token, { p_nombre: '      ', p_lat: PUEBLA.lat, p_lng: PUEBLA.lng }, '22023', /entre 3 y 40/],
        ['nombre de 41', A.token, { p_nombre: `[FIXTURE] ${'x'.repeat(31)}`, p_lat: PUEBLA.lat, p_lng: PUEBLA.lng }, '22023', /entre 3 y 40/],
        ['descripcion de 301', A.token, { p_nombre: `[FIXTURE] D ${marca}`, p_lat: PUEBLA.lat, p_lng: PUEBLA.lng, p_descripcion: 'd'.repeat(301) }, '22023', /300/],
        ['latitud 91', A.token, { p_nombre: `[FIXTURE] L ${marca}`, p_lat: 91, p_lng: PUEBLA.lng }, '22023', /Ubicacion invalida/],
        ['visitante (anon)', undefined, { p_nombre: `[FIXTURE] V ${marca}`, p_lat: PUEBLA.lat, p_lng: PUEBLA.lng }, '42501', /permission denied/],
      ];
      const vistos = [];
      for (const [que, token, args, code, re] of casos) {
        const r = await rpc(cfg, token, 'fundar_comunidad', args);
        exigir(r.status >= 400 && r.body?.code === code && re.test(r.body?.message ?? ''), `${que}: ${r.status} ${JSON.stringify(r.body)}`);
        vistos.push(`${que}=${r.status}/${code}`);
      }
      mismoConteo(antes, await conteo(ids), 'tras los rechazos');
      return vistos.join(', ');
    });

    // ─── A en la UI ───────────────────────────────────────────────────────
    const { ctx: ctxA, cuentas: mkA } = await contexto(browser);
    const pa = await ctxA.newPage();
    pa.on('pageerror', (e) => errores.push(`A: ${e.message}`));
    await paso('login real de A (fundador)', () => login(pa, A));

    let dlg = null;
    await paso('UI: el FAB abre «Fundar una comunidad» con el centro ya puesto (cookie)', async () => {
      await irAComunidades(pa);
      dlg = await abrirFundar(pa);
      await dlg.getByRole('heading', { name: 'Fundar una comunidad' }).waitFor({ timeout: 10_000 });
      await esperarMapa(pa);
      const c = mkA();
      exigir(c.script > 0 && c.token > 0, `MapKit falso sin usar: ${JSON.stringify(c)}`);
      return `MapKit falso ${JSON.stringify(c)}`;
    });

    await paso('UI: campos incompletos → boton deshabilitado con la regla a la vista, sin crear nada', async () => {
      const antes = await conteo(ids);
      const nombre = dlg.locator('#fundar-nombre');
      const boton = enviar(dlg);
      exigir(await boton.isDisabled(), 'con el nombre vacio el boton esta habilitado');
      await nombre.pressSequentially('ab');
      exigir(await boton.isDisabled(), 'con 2 caracteres el boton esta habilitado');
      await dlg.getByText('Entre 3 y 40 caracteres. El nombre no se puede cambiar después.').waitFor({ timeout: 5_000 });
      await dlg.getByText('2/40').waitFor({ timeout: 5_000 });
      await nombre.fill('      ');
      exigir(await boton.isDisabled(), 'con solo espacios el boton esta habilitado');
      // Tecleado de verdad: maxLength corta en 40 y el contador lo dice.
      await nombre.fill('');
      await nombre.pressSequentially('N'.repeat(45), { delay: 5 });
      const largo = (await nombre.inputValue()).length;
      exigir(largo === 40, `el campo admitio ${largo} caracteres`);
      await dlg.getByText('40/40').waitFor({ timeout: 5_000 });
      await dlg.locator('#fundar-descripcion').fill('d'.repeat(320));
      const desc = (await dlg.locator('#fundar-descripcion').inputValue()).length;
      exigir(desc === 300, `la descripcion admitio ${desc} caracteres`);
      await dlg.getByText('300/300').waitFor({ timeout: 5_000 });
      // Sin centro (✕ Quitar ubicación) el boton se apaga otra vez.
      await dlg.getByRole('button', { name: /Quitar ubicación/ }).click();
      await pa.waitForTimeout(300);
      exigir(await boton.isDisabled(), 'sin centro el boton esta habilitado');
      const aviso = (await errorDelDrawer(dlg).count()) > 0 ? await errorDelDrawer(dlg).innerText() : '(ninguno)';
      await pa.screenshot({ path: path.join(OUT, 'comunidades-incompleto.png') });
      return `${mismoConteo(antes, await conteo(ids), 'con campos incompletos')}; aviso sin centro: ${aviso}`;
    });

    await paso('UI: cerrar con la X y con Escape no crea nada y descarta lo escrito', async () => {
      const antes = await conteo(ids);
      await dlg.getByRole('button', { name: 'Cerrar' }).click();
      await dlg.waitFor({ state: 'detached', timeout: 10_000 });
      await pa.waitForTimeout(1500);
      mismoConteo(antes, await conteo(ids), 'tras la X');
      dlg = await abrirFundar(pa);
      const tras = await dlg.locator('#fundar-nombre').inputValue();
      exigir(tras === '', `al reabrir el nombre seguia: «${tras}»`);
      await dlg.locator('#fundar-nombre').fill(`[FIXTURE] Escape ${marca}`);
      await pa.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached', timeout: 10_000 });
      await pa.waitForTimeout(1500);
      return mismoConteo(antes, await conteo(ids), 'tras Escape');
    });

    await paso('UI: envio valido crea UNA comunidad publica con A como owner y fundador', async () => {
      const antes = await conteo(ids);
      dlg = await abrirFundar(pa);
      await esperarMapa(pa);
      await dlg.locator('#fundar-nombre').fill(nombre1);
      await dlg.locator('#fundar-descripcion').fill('Comunidad sintetica de pruebas S07');
      await enviar(dlg).click();
      await pa.waitForURL(UUID_RE, { timeout: 30_000 });
      id1 = new URL(pa.url()).pathname.match(UUID_RE)[1];
      const ahora = await conteo(ids);
      exigir(ahora.total === antes.total + 1 && ahora.comunidades === antes.comunidades + 1, `conteo ${JSON.stringify(antes)} -> ${JSON.stringify(ahora)}`);
      exigir(ahora.membresias === antes.membresias + 1, `membresias ${antes.membresias} -> ${ahora.membresias}`);
      exigir(ahora.ledger === antes.ledger, 'fundar escribio en community_post_quota');
      const c = await comunidad(id1);
      exigir(c && c.nombre === nombre1 && c.owner_id === A.id && c.fundador_id === A.id, `fila: ${JSON.stringify(c)}`);
      exigir(c.es_privada === false && c.archived_at === null && c.is_hidden === false && c.miembros_count === 1, `estado: ${JSON.stringify(c)}`);
      // El centro se guarda redondeado a la rejilla (2 decimales), no el punto exacto.
      exigir(c.lat === 19.04 && c.lng === -98.21, `centro ${c.lat},${c.lng}`);
      const m = await miembros(id1);
      exigir(m.length === 1 && m[0].user_id === A.id && m[0].role === 'owner' && m[0].left_at === null, `miembros: ${JSON.stringify(m)}`);
      return `id ${id1.slice(0, 8)}, centro ${c.lat},${c.lng}, miembros [owner A]`;
    });

    await paso('UI: A ve «Administrar» y el panel de owner, sin «Archivar» (16-sep)', async () => {
      requiere(id1);
      await pa.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await pa.getByRole('link', { name: 'Administrar' }).waitFor({ timeout: 30_000 });
      const ruta = await rutaFinal(pa, `${BASE}/comunidades/${id1}/administrar`);
      exigir(ruta === `/comunidades/${id1}/administrar`, `fue a ${ruta}`);
      await pa.getByRole('heading', { name: nombre1 }).waitFor({ timeout: 30_000 });
      for (const t of ['Descripción', 'Visibilidad', 'Centro de la comunidad', 'Moderadores']) {
        await pa.getByRole('heading', { name: t, exact: true }).waitFor({ timeout: 10_000 });
      }
      const texto = await pa.locator('main').innerText().catch(() => pa.locator('body').innerText());
      exigir(!/archivar/i.test(texto), 'el panel ofrece archivar');
      await pa.screenshot({ path: path.join(OUT, 'comunidades-administrar.png') });
    });

    await paso('UI: segunda en el mismo sitio → error claro de la CUOTA C y nada creado', async () => {
      requiere(id1);
      const antes = await conteo(ids);
      await irAComunidades(pa);
      dlg = await abrirFundar(pa);
      await dlg.locator('#fundar-nombre').fill(nombre2);
      await enviar(dlg).click();
      await errorDelDrawer(dlg).waitFor({ timeout: 20_000 });
      const msg = await errorDelDrawer(dlg).innerText();
      exigir(msg === 'Ya tienes una comunidad a menos de 1 km de aquí.', `mensaje: «${msg}»`);
      exigir(await dlg.isVisible(), 'el drawer se cerro');
      mismoConteo(antes, await conteo(ids), 'tras la CUOTA C');
      await pa.screenshot({ path: path.join(OUT, 'comunidades-cuota-c.png') });
      return msg;
    });

    await paso('UI: moviendo el pin a >1 km y marcando «privada», la SEGUNDA se funda al momento (sin la espera de 24 h)', async () => {
      requiere(id1);
      exigir(dlg && (await dlg.isVisible().catch(() => false)), 'el drawer del paso anterior no sigue abierto');
      const antes = await conteo(ids);
      await esperarMapa(pa);
      await pa.evaluate(([lat, lng]) => window.__mk.tocar(lat, lng), [NORTE.lat, NORTE.lng]);
      await pa.waitForTimeout(300);
      const sw = dlg.getByRole('switch', { name: /Comunidad privada/ });
      await sw.click();
      exigir((await sw.getAttribute('aria-checked')) === 'true', 'el interruptor no quedo en privada');
      await enviar(dlg).click();
      await pa.waitForURL(UUID_RE, { timeout: 30_000 });
      id2 = new URL(pa.url()).pathname.match(UUID_RE)[1];
      exigir(id2 !== id1, 'volvio a la primera');
      const ahora = await conteo(ids);
      exigir(ahora.comunidades === antes.comunidades + 1 && ahora.membresias === antes.membresias + 1, `${JSON.stringify(antes)} -> ${JSON.stringify(ahora)}`);
      const [c1, c2] = [await comunidad(id1), await comunidad(id2)];
      exigir(c2.es_privada === true && c2.owner_id === A.id && c2.nombre === nombre2, `fila: ${JSON.stringify(c2)}`);
      exigir(c2.lat === 19.1 && c2.lng === -98.2, `centro ${c2.lat},${c2.lng}`);
      const seg = (Date.parse(c2.created_at) - Date.parse(c1.created_at)) / 1000;
      exigir(seg < 3600, `separacion ${seg}s`);
      return `privada, centro ${c2.lat},${c2.lng}, ${Math.round(seg)} s despues de la primera`;
    });

    await paso('RPC: la tercera vale; con 3 vivas estado_cuota dice que no y sin reloj (CUOTA A)', async () => {
      requiere(id1, id2);
      const r = await rpc(cfg, A.token, 'fundar_comunidad', { p_nombre: `[FIXTURE] Tercera ${marca}`, p_lat: PONIENTE.lat, p_lng: PONIENTE.lng });
      exigir(r.status === 200 && r.body?.id, `tercera: ${r.status} ${JSON.stringify(r.body)}`);
      id3 = r.body.id;
      const e = (await rpc(cfg, A.token, 'estado_cuota_fundacion', {})).body;
      exigir(e.puede_fundar === false && e.fundadas_vivas === 3 && e.siguiente_en === null, JSON.stringify(e));
      exigir(/Ya fundaste 3 comunidades/.test(e.motivo ?? ''), `motivo: ${e.motivo}`);
      return `motivo «${e.motivo}»`;
    });

    await paso('UI: con la CUOTA A agotada el FAB queda deshabilitado y dice por que', async () => {
      requiere(id1, id2, id3);
      await irAComunidades(pa);
      const f = fab(pa);
      await f.waitFor({ timeout: 60_000 });
      const hasta = Date.now() + 20_000;
      while (Date.now() < hasta && !(await f.isDisabled())) await pa.waitForTimeout(500);
      exigir(await f.isDisabled(), 'el FAB sigue habilitado');
      const etiqueta = await f.getAttribute('aria-label');
      exigir(/Ya fundaste 3 comunidades/.test(etiqueta ?? ''), `aria-label: ${etiqueta}`);
      const visible = (await f.innerText()).trim();
      exigir(visible === 'Sin cupo', `texto del FAB: «${visible}»`);
      await pa.screenshot({ path: path.join(OUT, 'comunidades-sin-cupo.png') });
      return `aria-label «${etiqueta}», texto «${visible}»`;
    });

    await paso('RPC: la cuarta (lejos de las otras) se rechaza 23514 y no crea nada', async () => {
      requiere(id1, id2, id3);
      const antes = await conteo(ids);
      const r = await rpc(cfg, A.token, 'fundar_comunidad', { p_nombre: `[FIXTURE] Cuarta ${marca}`, p_lat: SUR.lat, p_lng: SUR.lng });
      exigir(r.status === 400 && r.body?.code === '23514' && /Ya fundaste 3/.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body)}`);
      mismoConteo(antes, await conteo(ids), 'tras la cuarta');
      return r.body.message;
    });

    // ─── B, sin derechos ────────────────────────────────────────────────
    const lugaresB = [...LUGARES, { consulta: 'puebla', displayLines: ['Puebla', 'Puebla, México'], lat: PUEBLA.lat, lng: PUEBLA.lng, countryCode: 'MX' }];
    const { ctx: ctxB } = await contexto(browser, { cookie: false, lugares: lugaresB });
    const pb = await ctxB.newPage();
    pb.on('pageerror', (e) => errores.push(`B: ${e.message}`));
    await paso('login real de B (otro usuario, sin cookie de zona y sin permiso de GPS)', async () => { await login(pb, B); bDentro = true; });

    await paso('UI: B sin centro → GPS denegado da salida a buscar; con el mismo nombre en la misma celda, error claro y nada creado', async () => {
      requiere(id1, bDentro);
      const antes = await conteo(ids);
      await irAComunidades(pb);
      const d = await abrirFundar(pb);
      await d.locator('#fundar-nombre').fill(nombre1);
      exigir(await enviar(d).isDisabled(), 'sin centro el boton esta habilitado');
      await d.getByRole('button', { name: 'Usar mi ubicación' }).click();
      await d.getByText('No pudimos obtener tu ubicación. Puedes buscar y elegir una dirección.').waitFor({ timeout: 20_000 });
      const buscador = d.getByPlaceholder('Busca el centro de la comunidad…');
      await buscador.waitFor({ timeout: 20_000 });
      const listo = Date.now() + 20_000;
      while (Date.now() < listo && (await buscador.isDisabled())) await pb.waitForTimeout(300);
      await buscador.pressSequentially('puebla', { delay: 30 });
      const sugerencia = d.getByRole('button', { name: /Puebla/ }).first();
      await sugerencia.waitFor({ timeout: 20_000 });
      await sugerencia.click();
      const habil = Date.now() + 15_000;
      while (Date.now() < habil && (await enviar(d).isDisabled())) await pb.waitForTimeout(300);
      exigir(!(await enviar(d).isDisabled()), 'tras elegir el centro el boton sigue deshabilitado');
      await enviar(d).click();
      await errorDelDrawer(d).waitFor({ timeout: 20_000 });
      const msg = await errorDelDrawer(d).innerText();
      exigir(msg === 'Ya existe una comunidad con ese nombre por aquí.', `mensaje: «${msg}»`);
      mismoConteo(antes, await conteo(ids), 'tras el nombre repetido');
      await pb.screenshot({ path: path.join(OUT, 'comunidades-nombre-repetido.png') });
      await d.getByRole('button', { name: 'Cerrar' }).click();
      return msg;
    });

    await paso('UI: B no ve «Administrar» y /administrar lo devuelve a la comunidad', async () => {
      requiere(id1, bDentro);
      await irA(pb, `${BASE}/comunidades/${id1}`);
      await pb.getByRole('button', { name: 'Únete' }).waitFor({ timeout: 30_000 });
      exigir((await pb.getByRole('link', { name: 'Administrar' }).count()) === 0, 'B ve el enlace Administrar');
      const ruta = await rutaFinal(pb, `${BASE}/comunidades/${id1}/administrar`);
      exigir(ruta === `/comunidades/${id1}`, `B quedo en ${ruta}`);
      exigir((await pb.getByRole('heading', { name: 'Moderadores', exact: true }).count()) === 0, 'B ve el panel');
      return ruta;
    });

    await paso('UI: B se une (miembro) y sigue sin mando: sin «Administrar» y /administrar lo rebota', async () => {
      requiere(id1, bDentro);
      await irA(pb, `${BASE}/comunidades/${id1}`);
      const unete = pb.getByRole('button', { name: 'Únete' });
      await unete.waitFor({ timeout: 30_000 });
      const hasta = Date.now() + 30_000;
      let m = [];
      while (Date.now() < hasta) {
        m = (await miembros(id1)).filter((x) => x.user_id === B.id && x.left_at === null);
        if (m.length) break;
        if (await unete.isVisible().catch(() => false)) await unete.click().catch(() => {});
        await pb.waitForTimeout(1500);
      }
      exigir(m.length === 1 && m[0].role === 'member', `membresia de B: ${JSON.stringify(m)}`);
      bUnido = true;
      await irA(pb, pb.url());
      await pb.getByRole('button', { name: new RegExp(`Salir de`) }).first().waitFor({ timeout: 30_000 });
      exigir((await pb.getByRole('link', { name: 'Administrar' }).count()) === 0, 'B miembro ve Administrar');
      const ruta = await rutaFinal(pb, `${BASE}/comunidades/${id1}/administrar`);
      exigir(ruta === `/comunidades/${id1}`, `B miembro quedo en ${ruta}`);
      exigir((await pb.getByRole('heading', { name: 'Moderadores', exact: true }).count()) === 0, 'B miembro ve el panel');
      return 'role=member';
    });

    await paso('REST/RPC con el token de B: ni tablas ni RPC de mando le dejan cambiar nada', async () => {
      requiere(id1);
      const antes = await comunidad(id1);
      const intentos = [
        ['PATCH communities', () => http(cfg, 'PATCH', `/rest/v1/communities?id=eq.${id1}`, { token: B.token, body: { descripcion: 'hack', es_privada: true, owner_id: B.id }, prefer: 'return=representation' })],
        ['DELETE communities', () => http(cfg, 'DELETE', `/rest/v1/communities?id=eq.${id1}`, { token: B.token, prefer: 'return=representation' })],
        ['POST community_members owner', () => http(cfg, 'POST', '/rest/v1/community_members', { token: B.token, body: { community_id: id1, user_id: B.id, role: 'owner' }, prefer: 'return=representation' })],
        ['PATCH community_members role', () => http(cfg, 'PATCH', `/rest/v1/community_members?community_id=eq.${id1}&user_id=eq.${B.id}`, { token: B.token, body: { role: 'owner' }, prefer: 'return=representation' })],
        ['rpc editar_descripcion_comunidad', () => rpc(cfg, B.token, 'editar_descripcion_comunidad', { p_community_id: id1, p_descripcion: 'hack' })],
        ['rpc editar_visibilidad_comunidad', () => rpc(cfg, B.token, 'editar_visibilidad_comunidad', { p_community_id: id1, p_privada: true })],
        ['rpc editar_centro_comunidad', () => rpc(cfg, B.token, 'editar_centro_comunidad', { p_community_id: id1, p_lat: SUR.lat, p_lng: SUR.lng })],
        // A si mismo cae antes en 'Quien manda ya modera.' (22023); a otro llega a la guarda de mando (42501).
        ['rpc nombrar_moderador_comunidad (a si mismo)', () => rpc(cfg, B.token, 'nombrar_moderador_comunidad', { p_community_id: id1, p_user_id: B.id })],
        ['rpc nombrar_moderador_comunidad (a A)', () => rpc(cfg, B.token, 'nombrar_moderador_comunidad', { p_community_id: id1, p_user_id: A.id })],
        ['rpc quitar_moderador_comunidad', () => rpc(cfg, B.token, 'quitar_moderador_comunidad', { p_community_id: id1, p_user_id: A.id })],
        ['rpc archivar_comunidad', () => rpc(cfg, B.token, 'archivar_comunidad', { p_community_id: id1 })],
        ['rpc solicitudes_de_comunidad', () => rpc(cfg, B.token, 'solicitudes_de_comunidad', { p_community_id: id1 })],
        ['rpc centro_de_mi_comunidad', () => rpc(cfg, B.token, 'centro_de_mi_comunidad', { p_community_id: id1 })],
      ];
      const vistos = [];
      for (const [que, fn] of intentos) {
        const r = await fn();
        // Rechazo explicito, o (lecturas de mando) cero filas: nunca un 2xx con efecto.
        const vacio = r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
        exigir(r.status >= 400 || vacio, `${que}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
        vistos.push(`${que.replace(/^rpc /, '')}=${r.status}${r.body?.code ? `/${r.body.code}` : vacio ? '/[]' : ''}`);
      }
      const despues = await comunidad(id1);
      for (const k of ['nombre', 'descripcion', 'owner_id', 'fundador_id', 'es_privada', 'archived_at', 'lat', 'lng', 'is_hidden']) {
        exigir(JSON.stringify(antes[k]) === JSON.stringify(despues[k]), `${k}: ${antes[k]} -> ${despues[k]}`);
      }
      const m = await miembros(id1);
      const rol = Object.fromEntries(m.filter((x) => !x.left_at).map((x) => [x.user_id, x.role]));
      // B es miembro solo si el paso de unirse corrio; en ningun caso gana mando.
      exigir(rol[A.id] === 'owner' && rol[B.id] === (bUnido ? 'member' : undefined) && m.length === (bUnido ? 2 : 1), `roles: ${JSON.stringify(m)}`);
      const [roles] = await leer(cfg, `select count(*)::int n from public.user_roles where user_id = ${q(B.id)}`);
      exigir(roles.n === 0, `B gano ${roles.n} roles globales`);
      return vistos.join(', ');
    });

    await paso('Cuotas intactas: A 3/3, B 0/3 y el ledger sin asientos de fundar ni de los intentos', async () => {
      requiere(id1, id2, id3);
      const ea = (await rpc(cfg, A.token, 'estado_cuota_fundacion', {})).body;
      const eb = (await rpc(cfg, B.token, 'estado_cuota_fundacion', {})).body;
      exigir(ea.fundadas_vivas === 3 && ea.puede_fundar === false, `A: ${JSON.stringify(ea)}`);
      exigir(eb.fundadas_vivas === 0 && eb.puede_fundar === true, `B: ${JSON.stringify(eb)}`);
      const c = await conteo(ids);
      exigir(c.ledger === 0, `ledger ${c.ledger}`);
      exigir(c.comunidades === 3 && c.membresias === 3 + (bUnido ? 1 : 0), `conteo ${JSON.stringify(c)}`);
      return JSON.stringify(c);
    });

    await paso('RPC: con la cuenta suspendida no se funda (42501) y estado_cuota lo dice', async () => {
      await suspender(cfg, B.id, true);
      try {
        const e = (await rpc(cfg, B.token, 'estado_cuota_fundacion', {})).body;
        exigir(e.puede_fundar === false && /suspendida/.test(e.motivo ?? ''), JSON.stringify(e));
        const r = await rpc(cfg, B.token, 'fundar_comunidad', { p_nombre: `[FIXTURE] Suspendida ${marca}`, p_lat: SUR.lat, p_lng: SUR.lng });
        exigir(r.status === 403 && r.body?.code === '42501', `${r.status} ${JSON.stringify(r.body)}`);
        return `${e.motivo} / ${r.status}`;
      } finally {
        await suspender(cfg, B.id, false);
      }
    });

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length && n === 0 ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
