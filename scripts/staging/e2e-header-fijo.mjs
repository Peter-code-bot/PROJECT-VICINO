#!/usr/bin/env node
/**
 * Header movil fijo al hacer scroll (reporte de Pedro, 26-sep; arreglo 209caf7).
 * Visitante sin sesion a 390x844: en Home, en una ficha y en /solicitudes/<id>
 * baja la pagina y comprueba que el header sigue en top 0 con sus acciones, y
 * que las barras sticky de la pagina quedan DEBAJO del header, no tapadas.
 *
 *   E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-header-fijo.mjs
 *
 * Solo lectura.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'https://vicinomarket.com';
const OUT = path.join(CONFIG_DIR, 'e2e');
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const medir = (page, bajar) => page.evaluate(async (bajar) => {
  window.scrollTo(0, bajar);
  await new Promise((r) => setTimeout(r, 400));
  const h = document.querySelector('header');
  const r = h.getBoundingClientRect();
  const acciones = [...h.querySelectorAll('a[aria-label],button[aria-label]')].map((b) => b.getAttribute('aria-label'));
  return { top: Math.round(r.top), alto: Math.round(r.height), scrollY: Math.round(window.scrollY), acciones };
}, bajar);

const exigirFijo = (m, minScroll) => {
  if (m.scrollY < minScroll) throw new Error(`la pagina solo bajo ${m.scrollY}px`);
  if (m.top !== 0) throw new Error(`header en top ${m.top} con scroll ${m.scrollY}`);
  if (!m.acciones.includes('Rankings') || !m.acciones.includes('Notificaciones')) throw new Error(`acciones: ${m.acciones}`);
  return `scroll ${m.scrollY}, header top ${m.top}, ${m.acciones.join('/')}`;
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', isMobile: true, hasTouch: true });
  // Sin la cookie de ubicacion el feed de solicitudes pinta «Activa tu
  // ubicación» y nunca pide datos: el paso 3 no veia ninguna solicitud.
  await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent('19.0414,-98.2063'), url: BASE }]);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/`, { timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    const ficha = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
      .find((h) => /^\/[a-z-]+\/[a-z0-9-]+-[0-9a-f]{6}$/.test(h)));

    await paso('Home: header fijo tras bajar', async () => exigirFijo(await medir(page, 1200), 600));
    await page.screenshot({ path: path.join(OUT, 'header-home.png') });

    await paso('Ficha: header fijo tras bajar', async () => {
      if (!ficha) throw new Error('no hay fichas en Home');
      await page.goto(`${BASE}${ficha}`, { timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      return exigirFijo(await medir(page, 700), 300);
    });
    await page.screenshot({ path: path.join(OUT, 'header-ficha.png') });

    await paso('Solicitudes: header fijo y su barra debajo del header', async () => {
      await page.goto(`${BASE}/?feed=solicitudes`, { timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      const sol = await page.evaluate(() => [...document.querySelectorAll('a[href^="/solicitudes/"]')].map((a) => a.getAttribute('href'))[0]);
      // Antes esto daba OK sin probar el detalle (falso verde). Sin datos se dice.
      if (!sol) throw new Error('SIN DATOS: no hay solicitudes abiertas visibles; el detalle no se probo');
      await page.goto(`${BASE}${sol}`, { timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      const m = await medir(page, 600);
      const barra = await page.evaluate(() => {
        const b = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'sticky' && d.querySelector('h1'));
        return b ? Math.round(b.getBoundingClientRect().top) : null;
      });
      if (m.top !== 0) throw new Error(`header en top ${m.top}`);
      if (m.scrollY < 300) throw new Error(`la pagina solo bajo ${m.scrollY}px: sin scroll la barra no se prueba`);
      if (barra === null) throw new Error('no se encontro la barra de la solicitud');
      if (barra < m.alto) throw new Error(`barra en ${barra}, tapada por el header de ${m.alto}px`);
      return `header top ${m.top}, barra en ${barra}px (header ${m.alto}px), scroll ${m.scrollY}`;
    });

  } finally {
    await browser.close();
  }
  const ok = resultados.filter(Boolean).length;
  console.log(`\nResultado contra ${BASE}: ${ok}/${resultados.length} pasos OK.`);
  process.exitCode = ok === resultados.length ? 0 : 1;
};

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(2); });
