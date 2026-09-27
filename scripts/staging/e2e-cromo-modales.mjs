#!/usr/bin/env node
/**
 * P0 iOS (Tarea 2 de la jornada del 26-sep): el cromo nativo de vidrio
 * (apps/web/ios/App/App/CromoNativo.swift) se oculta solo si la pagina declara
 * un modal con el MISMO selector que usa su puente JS. El formulario "+" de
 * Solicitudes y el agendador de citas no lo declaraban y la tab bar nativa
 * quedaba encima. Tambien se comprueba el bloqueo de scroll: gestures.ts lee
 * body.style.overflow === "hidden" para cancelar el swipe de pestana.
 *
 *   node scripts/staging/e2e-cromo-modales.mjs   (web local :3100 contra staging)
 *
 * Fixtures sinteticos (@staging.vicino.test); se retiran al final.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR, sql } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, leer, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Copia literal del selector de modal de CromoNativo.swift (reportar()).
const SEL_MODAL = '[aria-modal="true"], [role="dialog"][data-state="open"], [data-modal-open="true"]';
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

const estado = (page) => page.evaluate((sel) => ({
  modal: !!document.querySelector(sel),
  overflow: document.body.style.overflow,
}), SEL_MODAL);

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const vendedor = await crearUsuario(cfg, 'cromo-vendedor');
  await completarOnboarding(cfg, vendedor.id);
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(vendedor.id)}`);
  const comprador = await crearUsuario(cfg, 'cromo-comprador');
  await completarOnboarding(cfg, comprador.id);
  const [cat] = await leer(cfg, 'select slug from public.categories order by slug limit 1');
  const [prod] = await sql(cfg.ref, `insert into public.products_services
      (creador_id, titulo, descripcion, categoria, precio, estatus, allow_appointments, ubicacion_geo)
    values (${q(vendedor.id)}, '[FIXTURE] cromo cita', 'Producto sintetico', ${q(cat.slug)}, 150, 'disponible', true,
            ST_SetSRID(ST_MakePoint(-98.2063, 19.0414), 4326)::geography)
    returning id, slug, categoria`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  try {
    await paso('login real del comprador', () => login(page, comprador));

    await paso('Solicitudes: el formulario + se declara modal y fija el scroll', async () => {
      await page.goto(`${BASE}/?feed=solicitudes`, { timeout: 180_000 });
      const fab = page.getByRole('button', { name: 'Crear solicitud' });
      await fab.waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200); // hidratacion
      const antes = await estado(page);
      if (antes.modal) throw new Error('ya habia un modal antes de abrir');
      await fab.click();
      await page.getByRole('dialog', { name: 'Nueva solicitud' }).waitFor({ timeout: 10_000 });
      const abierto = await estado(page);
      if (!abierto.modal) throw new Error('abierto sin marca de modal: el cromo nativo quedaria encima');
      if (abierto.overflow !== 'hidden') throw new Error(`body.overflow=${abierto.overflow}: el swipe de pestana seguiria vivo`);
      await page.screenshot({ path: path.join(OUT, 'cromo-solicitud-abierta.png') });
      return `modal=${abierto.modal} overflow=${abierto.overflow}`;
    });

    await paso('Solicitudes: Escape (el Atras de Android) cierra, quita la marca y devuelve el scroll', async () => {
      // capacitor-init.tsx traduce el boton Atras de Android en un keydown
      // Escape cuando hay [data-modal-open]: sin listener, Atras quedaria muerto.
      await page.keyboard.press('Escape');
      await page.waitForFunction((sel) => !document.querySelector(sel), SEL_MODAL, { timeout: 10_000 });
      const cerrado = await estado(page);
      if (cerrado.overflow === 'hidden') throw new Error('el scroll quedo bloqueado');
    });

    await paso('Ficha: el agendador de citas se declara modal y Escape lo cierra', async () => {
      await page.goto(`${BASE}/${prod.categoria}/${prod.slug}`, { timeout: 180_000 });
      const boton = page.getByRole('button', { name: 'Agendar cita' });
      await boton.waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      await boton.click();
      await page.getByRole('dialog', { name: 'Agendar cita' }).waitFor({ timeout: 10_000 });
      const abierto = await estado(page);
      if (!abierto.modal || abierto.overflow !== 'hidden') throw new Error(JSON.stringify(abierto));
      await page.screenshot({ path: path.join(OUT, 'cromo-cita-abierta.png') });
      await page.keyboard.press('Escape'); // el Atras de Android
      await page.waitForFunction((sel) => !document.querySelector(sel), SEL_MODAL, { timeout: 10_000 });
      if ((await estado(page)).overflow === 'hidden') throw new Error('el scroll quedo bloqueado');
      return `modal=${abierto.modal} overflow=${abierto.overflow}`;
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
