#!/usr/bin/env node
/**
 * S01 (pendiente E2E-S01-retorno-vender): el boton «Volver» de /vender, con
 * sesion real. Las reglas viven en apps/web/lib/navigation/retorno-vender.ts
 * (resolverDestinoRetornoVender); aqui se comprueban en el navegador, que es
 * donde entran sessionStorage, document.referrer y el tipo de navegacion.
 *
 *   node scripts/staging/e2e-retorno-vender.mjs   (web local :3100 contra staging)
 *
 * Fixtures sinteticos (@staging.vicino.test); se retiran al final.
 */
import { createRequire } from 'node:module';
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

const ruta = (page) => new URL(page.url()).pathname;

/** Pulsa «Volver» cuando el formulario ya hidrato y espera a salir de /vender. */
const volver = async (page) => {
  const boton = page.getByTestId('volver-vender-btn');
  await boton.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200); // hidratacion: un clic antes se pierde
  await boton.click();
  await page.waitForURL((url) => !url.pathname.startsWith('/vender'), { timeout: 20_000 });
  return ruta(page);
};

/** Llega a /vender por navegacion del cliente, pulsando un enlace de la pagina. */
const irAVenderDesde = async (page, origen) => {
  await page.goto(`${BASE}${origen}`, { timeout: 180_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const enlace = page.locator('a[href^="/vender"]:not([href*="/editar"]):visible').first();
  await enlace.waitFor({ timeout: 30_000 });
  await enlace.click();
  await page.waitForURL((url) => url.pathname === '/vender', { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const vendedor = await crearUsuario(cfg, 'retorno-vender');
  await completarOnboarding(cfg, vendedor.id);
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(vendedor.id)}`);
  const productoId = await crearProducto(cfg, vendedor.id, { titulo: 'retorno vender' });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  try {
    await paso('login real del vendedor', () => login(page, vendedor));

    await paso('desde /buscar por la barra inferior: Volver regresa a /buscar', async () => {
      await irAVenderDesde(page, '/buscar');
      const destino = await volver(page);
      if (destino !== '/buscar') throw new Error(`fue a ${destino}`);
      return destino;
    });

    await paso('desde Mis publicaciones: Volver regresa a /seller/listings', async () => {
      await irAVenderDesde(page, '/seller/listings');
      const destino = await volver(page);
      if (destino !== '/seller/listings') throw new Error(`fue a ${destino}`);
      return destino;
    });

    await paso('?from=/favoritos manda aunque el origen guardado sea otro', async () => {
      await page.goto(`${BASE}/vender?from=${encodeURIComponent('/favoritos')}`, { timeout: 180_000 });
      const destino = await volver(page);
      if (destino !== '/favoritos') throw new Error(`fue a ${destino}`);
      return destino;
    });

    await paso('entrada directa (URL tecleada, sin referrer): Volver va a Inicio y no a un origen viejo', async () => {
      const directa = await ctx.newPage();
      directa.on('pageerror', (e) => errores.push(e.message));
      // sessionStorage es por pestana: se siembra un origen viejo para comprobar
      // que la entrada directa lo descarta.
      await directa.goto(`${BASE}/buscar`, { timeout: 180_000 });
      await directa.evaluate(() => sessionStorage.setItem('vicino:origen-vender', '/favoritos'));
      await directa.goto(`${BASE}/vender`, { timeout: 180_000, referer: '' });
      const destino = await volver(directa);
      await directa.close();
      if (destino !== '/') throw new Error(`fue a ${destino}`);
      return destino;
    });

    await paso('?from= hacia otro dominio se ignora (Inicio)', async () => {
      await page.goto(`${BASE}/vender?from=${encodeURIComponent('//evil.example/x')}`, { timeout: 180_000 });
      const destino = await volver(page);
      if (destino !== '/') throw new Error(`fue a ${destino}`);
      if (!page.url().startsWith(BASE)) throw new Error(`salio del sitio: ${page.url()}`);
      return destino;
    });

    await paso('editar una publicacion: Volver va a /seller/listings', async () => {
      await page.goto(`${BASE}/buscar`, { timeout: 180_000 });
      await page.goto(`${BASE}/vender/${productoId}/editar`, { timeout: 180_000 });
      const destino = await volver(page);
      if (destino !== '/seller/listings') throw new Error(`fue a ${destino}`);
      await page.screenshot({ path: path.join(OUT, 'retorno-vender-editar.png') });
      return destino;
    });

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
