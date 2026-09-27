#!/usr/bin/env node
/**
 * Regresion del reporte de Javier (26-sep): "me muevo entre paginas, vuelvo a
 * Home y los chips de categorias no responden a los toques". Web local contra
 * STAGING (dev-contra-staging.mjs en :3100), visitante sin sesion.
 *
 *   node scripts/staging/e2e-chips-home.mjs
 *
 * Crea un vendedor con productos en tres categorias (para que Home pinte
 * chips) y lo retira al final.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, leer, limpiar } from './fixtures.mjs';
import { sql } from './lib.mjs';

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
  const V = await crearUsuario(cfg, 'chips-vendedor');
  await completarOnboarding(cfg, V.id);
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(V.id)}`);
  const cats = await leer(cfg, 'select slug from public.categories order by slug limit 3');
  for (const [i, c] of cats.entries()) {
    await sql(cfg.ref, `insert into public.products_services (creador_id, titulo, descripcion, categoria, precio, estatus, ubicacion_geo)
      values (${q(V.id)}, ${q(`[FIXTURE] chip ${i}`)}, 'Producto sintetico', ${q(c.slug)}, 100, 'disponible',
              ST_SetSRID(ST_MakePoint(-98.2063, 19.0414), 4326)::geography)`);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, geolocation: { latitude: 19.0414, longitude: -98.2063 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const chips = () => page.locator('section[aria-label="Categorías del inicio"] button[aria-pressed]');
  const tocar = async (i) => {
    const chip = chips().nth(i);
    const antes = await chip.getAttribute('aria-pressed');
    await chip.click();
    await page.waitForFunction(([sel, i, antes]) => document.querySelectorAll(sel)[i]?.getAttribute('aria-pressed') !== antes,
      ['section[aria-label="Categorías del inicio"] button[aria-pressed]', i, antes], { timeout: 5_000 });
    return chip.getAttribute('aria-pressed');
  };

  try {
    await paso('Home pinta chips de categoria', async () => {
      await page.goto(`${BASE}/`, { timeout: 180_000 });
      await chips().first().waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500); // hidratacion
      return `${await chips().count()} chips`;
    });
    await paso('tocar un chip lo selecciona y escribe ?cats=', async () => {
      const estado = await tocar(0);
      const url = new URL(page.url());
      if (estado !== 'true' || !url.searchParams.get('cats')) throw new Error(`aria-pressed=${estado} url=${url.search}`);
      return url.search;
    });
    await paso('tocarlo otra vez lo deselecciona y limpia la URL', async () => {
      const estado = await tocar(0);
      if (estado !== 'false' || new URL(page.url()).searchParams.get('cats')) throw new Error(`aria-pressed=${estado} url=${page.url()}`);
    });
    await paso('ir a Buscar y volver a Home: los chips siguen respondiendo (reporte de Javier)', async () => {
      await page.locator('#home-see-all-categories').click();
      await page.waitForURL(/\/buscar/, { timeout: 60_000 });
      await page.goBack();
      await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 });
      await chips().first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const a = await tocar(1);
      const b = await tocar(1);
      if (a !== 'true' || b !== 'false') throw new Error(`secuencia ${a}/${b}`);
    });
    await paso('seleccion en la URL -> atras/adelante la restaura', async () => {
      // Carga limpia: encadenar dos "atras" en el mismo historial hacia fallar a la prueba, no a la app.
      await page.goto(`${BASE}/`, { timeout: 120_000 });
      await chips().nth(2).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      await tocar(2);
      const conCats = page.url();
      await page.locator('#home-see-all-categories').click();
      await page.waitForURL(/\/buscar/, { timeout: 60_000 });
      await page.goBack();
      await page.waitForURL((u) => u.pathname === '/', { timeout: 60_000 });
      await chips().nth(2).waitFor({ timeout: 30_000 });
      const estado = await chips().nth(2).getAttribute('aria-pressed');
      if (estado !== 'true') throw new Error(`al volver: aria-pressed=${estado}, url=${page.url()} (antes ${conCats})`);
    });
    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await page.screenshot({ path: path.join(OUT, 'home-chips.png') }).catch(() => {});
    await browser.close();
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
