#!/usr/bin/env node
/**
 * S06-filtros-funcional (Busqueda): con 25 publicaciones sinteticas que casan
 * con un termino unico, comprueba paginacion (20 por pagina), filtro de precio,
 * orden y que cambiar un filtro vuelve a la pagina 1 (antes precio, orden y
 * ubicacion conservaban `page` y dejaban «Página 3 de 1» con la lista vacia).
 *
 *   node scripts/staging/e2e-busqueda-filtros.mjs   (web local :3100 contra staging)
 *
 * Fixtures @staging.vicino.test / '[FIXTURE]'; se retiran al final.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR, sql } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, crearProducto, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const marca = `zq${crypto.randomBytes(3).toString('hex')}`;
  const vendedor = await crearUsuario(cfg, 'busq-vendedor');
  await completarOnboarding(cfg, vendedor.id);
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(vendedor.id)}`);
  // El precio va en el titulo para leer el orden desde la tarjeta sin depender
  // del formato de moneda.
  for (let i = 1; i <= 25; i++) {
    await crearProducto(cfg, vendedor.id, { titulo: `P${String(i * 100).padStart(4, '0')} ${marca}`, precio: i * 100 });
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent('19.0414,-98.2063'), url: BASE }]);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  const precios = async () => (await page.locator(`a:has-text("${marca}")`).allInnerTexts())
    .map((t) => Number((t.match(/P(\d{4})/) || [])[1])).filter(Number.isFinite);
  const esperar = async (cond, desc) => {
    const hasta = Date.now() + 20_000;
    let ultimo;
    while (Date.now() < hasta) {
      ultimo = await precios();
      if (cond(ultimo)) return ultimo;
      await page.waitForTimeout(400);
    }
    throw new Error(`${desc}: ${JSON.stringify(ultimo)}`);
  };
  const param = (k) => new URL(page.url()).searchParams.get(k);
  const abrirFiltros = async () => {
    const panel = page.getByText('Precio (MXN)');
    for (let i = 0; i < 5 && !(await panel.isVisible().catch(() => false)); i++) {
      await page.locator('form button:has(svg.lucide-sliders-horizontal)').click();
      await panel.waitFor({ timeout: 3_000 }).catch(() => {});
    }
    await panel.waitFor({ timeout: 5_000 });
  };

  try {
    await paso('pagina 1: 20 resultados y «Página 1 de 2»', async () => {
      await page.goto(`${BASE}/buscar?q=${marca}`, { timeout: 180_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await esperar((p) => p.length === 20, '20 en la pagina 1');
      if (!(await page.getByText('Página 1 de 2').first().isVisible())) throw new Error('sin «Página 1 de 2»');
    });

    await paso('pagina 2: los 5 restantes', async () => {
      await page.goto(`${BASE}/buscar?q=${marca}&page=2`, { timeout: 180_000 });
      await page.waitForTimeout(1500);
      const p = await esperar((x) => x.length === 5, '5 en la pagina 2');
      return p.join(',');
    });

    await paso('en la pagina 2, precio maximo 500 vuelve a la pagina 1 y filtra', async () => {
      await abrirFiltros();
      await page.getByPlaceholder('Máx').fill('500');
      await page.waitForURL((u) => u.searchParams.get('price_max') === '500', { timeout: 20_000 });
      if (param('page')) throw new Error(`sigue page=${param('page')}`);
      const p = await esperar((x) => x.length === 5 && x.every((v) => v <= 500), 'solo <= 500');
      await page.screenshot({ path: path.join(OUT, 'busqueda-precio.png') });
      return p.sort((a, b) => a - b).join(',');
    });

    await paso('orden «Precio: mayor a menor» ordena y conserva el precio', async () => {
      await abrirFiltros();
      await page.locator('select').filter({ has: page.locator('option[value="price_desc"]') }).selectOption('price_desc');
      await page.waitForURL((u) => u.searchParams.get('sort') === 'price_desc', { timeout: 20_000 });
      if (param('price_max') !== '500') throw new Error('perdio price_max');
      const p = await esperar((x) => x.length === 5 && x.every((v, i) => i === 0 || x[i - 1] >= v), 'orden descendente');
      return p.join(',');
    });

    await paso('cambiar el orden desde la pagina 2 tambien vuelve a la 1', async () => {
      await page.goto(`${BASE}/buscar?q=${marca}&page=2`, { timeout: 180_000 });
      await page.waitForTimeout(1500);
      await abrirFiltros();
      await page.locator('select').filter({ has: page.locator('option[value="price_asc"]') }).selectOption('price_asc');
      await page.waitForURL((u) => u.searchParams.get('sort') === 'price_asc', { timeout: 20_000 });
      if (param('page')) throw new Error(`sigue page=${param('page')}`);
      const p = await esperar((x) => x.length === 20 && x[0] === 100, 'pagina 1 ascendente desde 100');
      return `${p[0]}..${p[p.length - 1]}`;
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
