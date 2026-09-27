#!/usr/bin/env node
/**
 * FIX-solicitudes-fixtures (plan en docs/planes-2026-09-26/): Solicitudes con
 * datos sinteticos del staging.
 *
 *   1. Base, sin UI: feed_nearby_requests como anon filtra por categoria,
 *      contando tambien la segunda categoria de una solicitud.
 *   2. /solicitudes/<id>: el header movil queda fijo en top 0 y la barra de la
 *      solicitud justo debajo, sin taparse (209caf7 la cambio sin probarla),
 *      para el visitante y para una sesion.
 *   3. S01 paso 7: en /?feed=solicitudes elegir una categoria deja solo sus
 *      tarjetas y la X las devuelve todas.
 *
 *   node scripts/staging/e2e-solicitudes.mjs   (web local :3100 contra staging)
 *
 * Solo cuenta tarjetas con la marca de esta corrida: el staging puede tener
 * otras solicitudes abiertas cerca. Fixtures (@staging.vicino.test) fuera al final.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, crearSolicitud, rpc, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const cfg = staging();
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const login = async (page, u) => {
  await page.goto(`${BASE}/login`, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

/** Sin la cookie de ubicacion el feed pinta «Activa tu ubicación» y no pide nada. */
const contexto = async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent(`${PUEBLA.lat},${PUEBLA.lng}`), url: BASE }]);
  return ctx;
};

/** Header global y barra de la solicitud tras bajar `bajar` px. */
const medirDetalle = (page, bajar) => page.evaluate(async (bajar) => {
  window.scrollTo(0, bajar);
  await new Promise((r) => setTimeout(r, 500));
  const h = document.querySelector('header');
  const hr = h.getBoundingClientRect();
  const acciones = [...h.querySelectorAll('a[aria-label],button[aria-label]')].map((b) => b.getAttribute('aria-label'));
  const barra = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'sticky' && d.querySelector('h1'));
  if (!barra) return { scrollY: Math.round(window.scrollY), header: Math.round(hr.top), alto: Math.round(hr.height), acciones, barra: null };
  const br = barra.getBoundingClientRect();
  const enCentro = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  return {
    scrollY: Math.round(window.scrollY), header: Math.round(hr.top), alto: Math.round(hr.height), acciones,
    barra: Math.round(br.top), visible: !!enCentro && barra.contains(enCentro),
  };
}, bajar);

const exigirDetalle = (m) => {
  if (m.scrollY < 300) throw new Error(`la pagina solo bajo ${m.scrollY}px: sin scroll real la prueba no dice nada`);
  if (m.header !== 0) throw new Error(`header en top ${m.header}`);
  if (!m.acciones.includes('Rankings') || !m.acciones.includes('Notificaciones')) throw new Error(`acciones: ${m.acciones}`);
  if (m.barra === null) throw new Error('no se encontro la barra de la solicitud');
  if (Math.abs(m.barra - m.alto) > 1) throw new Error(`barra en ${m.barra}px, header de ${m.alto}px`);
  if (!m.visible) throw new Error('la barra esta tapada');
  return `scroll ${m.scrollY}, header ${m.alto}px en top 0, barra en ${m.barra}px y visible`;
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const marca = crypto.randomBytes(3).toString('hex');
  const comprador = await crearUsuario(cfg, 'sol-comprador');
  await completarOnboarding(cfg, comprador.id);
  const lector = await crearUsuario(cfg, 'sol-lector');
  await completarOnboarding(cfg, lector.id);
  const larga = Array.from({ length: 40 }, (_, i) => `Linea ${i + 1} de una descripcion larga para que el detalle tenga scroll.`).join('\n');
  const t = (x) => `${x} ${marca}`;
  const idA = await crearSolicitud(cfg, comprador.id, { titulo: t('A comida y postres'), slugs: ['comida', 'postres'], descripcion: larga });
  const idB = await crearSolicitud(cfg, comprador.id, { titulo: t('B ropa'), slugs: ['ropa'] });
  const idC = await crearSolicitud(cfg, comprador.id, { titulo: t('C comida'), slugs: ['comida'] });
  const nombre = { [idA]: 'A', [idB]: 'B', [idC]: 'C' };

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  try {
    await paso('RPC feed_nearby_requests (anon): sin categoria A,B,C; ropa B; postres A; comida A,C', async () => {
      const leer = async (cat) => {
        const r = await rpc(cfg, undefined, 'feed_nearby_requests', {
          user_lat: PUEBLA.lat, user_lng: PUEBLA.lng, radius_meters: 10_000, cursor_time: null, result_limit: 100, cat_slug: cat,
        });
        if (r.status !== 200) throw new Error(`${cat}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        return r.body.map((f) => nombre[f.id]).filter(Boolean).sort().join(',');
      };
      const esperado = { '': 'A,B,C', ropa: 'B', postres: 'A', comida: 'A,C' };
      const obtenido = {};
      for (const cat of Object.keys(esperado)) obtenido[cat] = await leer(cat || null);
      for (const cat of Object.keys(esperado)) {
        if (obtenido[cat] !== esperado[cat]) throw new Error(`${cat || 'todas'}: ${obtenido[cat]} (esperado ${esperado[cat]})`);
      }
      return JSON.stringify(obtenido);
    });

    const visitante = await (await contexto(browser)).newPage();
    visitante.on('pageerror', (e) => errores.push(e.message));
    await paso('Detalle, visitante: header fijo y la barra de la solicitud justo debajo', async () => {
      await visitante.goto(`${BASE}/solicitudes/${idA}`, { timeout: 180_000 });
      await visitante.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await visitante.waitForTimeout(1200);
      return exigirDetalle(await medirDetalle(visitante, 600));
    });

    const ctxLector = await contexto(browser);
    const page = await ctxLector.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    await paso('login real del lector', () => login(page, lector));

    await paso('Detalle, con sesion: header fijo y la barra de la solicitud justo debajo', async () => {
      await page.goto(`${BASE}/solicitudes/${idA}`, { timeout: 180_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const r = exigirDetalle(await medirDetalle(page, 600));
      await page.screenshot({ path: path.join(OUT, 'header-solicitud.png') });
      return r;
    });

    const tarjetas = () => page.locator(`a[href^="/solicitudes/"]:has-text("${marca}")`);
    const visibles = async () => (await tarjetas().evaluateAll((els) => els.map((e) => e.getAttribute('href').split('/').pop())))
      .map((id) => nombre[id]).filter(Boolean).sort().join(',');
    const esperarTarjetas = async (esperado) => {
      const hasta = Date.now() + 20_000;
      let ultimo = '';
      while (Date.now() < hasta) {
        ultimo = await visibles();
        if (ultimo === esperado) return ultimo;
        await page.waitForTimeout(400);
      }
      throw new Error(`tarjetas ${ultimo || '(ninguna)'}, esperado ${esperado}`);
    };
    const elegir = async (slug) => {
      const disparador = page.getByTestId('filtro-categorias-trigger');
      const dialogo = page.getByRole('dialog');
      // Un clic antes de hidratar se pierde en silencio: se reintenta hasta ver el dialogo.
      for (let i = 0; i < 5 && !(await dialogo.isVisible().catch(() => false)); i++) {
        await disparador.click();
        await dialogo.waitFor({ timeout: 3_000 }).catch(() => {});
      }
      await dialogo.waitFor({ timeout: 5_000 });
      // Se deja elegida solo `slug`.
      for (const b of await dialogo.locator('[data-categoria-slug][aria-pressed="true"]').all()) {
        if (await b.getAttribute('data-categoria-slug') !== slug) await b.click();
      }
      const boton = dialogo.locator(`[data-categoria-slug="${slug}"]`);
      if (await boton.getAttribute('aria-pressed') !== 'true') await boton.click();
      await dialogo.getByRole('button', { name: 'Aplicar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: 10_000 });
    };

    await paso('Feed: las tres solicitudes de la corrida', async () => {
      await page.goto(`${BASE}/?feed=solicitudes`, { timeout: 180_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return esperarTarjetas('A,B,C');
    });

    await paso('S01 paso 7: Ropa deja solo B y el disparador lo dice', async () => {
      await elegir('ropa');
      await esperarTarjetas('B');
      const etiqueta = await page.getByTestId('filtro-categorias-trigger').innerText();
      if (!/Ropa/i.test(etiqueta)) throw new Error(`disparador: ${etiqueta}`);
      await page.screenshot({ path: path.join(OUT, 'solicitudes-filtro.png') });
      return etiqueta.trim();
    });

    await paso('S01 paso 7: Postres deja solo A (cuenta su segunda categoria)', async () => {
      await elegir('postres');
      return esperarTarjetas('A');
    });

    await paso('S01 paso 7: la X devuelve A, B y C y el disparador vuelve a «Categorías»', async () => {
      await page.getByTestId('filtro-categorias-trigger').getByRole('button', { name: 'Limpiar categoría' }).click();
      await esperarTarjetas('A,B,C');
      const etiqueta = (await page.getByTestId('filtro-categorias-trigger').innerText()).trim();
      if (etiqueta !== 'Categorías') throw new Error(`disparador: ${etiqueta}`);
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
