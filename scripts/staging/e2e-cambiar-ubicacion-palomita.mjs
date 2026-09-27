#!/usr/bin/env node
/**
 * Tarea 8 (decision de Pedro, 27-sep): en "Cambiar ubicacion", la X del
 * header pasa a palomita cuando hay cambios y aplica; ya no hay boton
 * "Aplicar ubicacion" al fondo de la hoja.
 *
 *   node scripts/staging/e2e-cambiar-ubicacion-palomita.mjs   (web local :3100)
 *   E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-cambiar-ubicacion-palomita.mjs
 *
 * Visitante sin sesion y solo con lo que no depende de MapKit (radio y
 * ubicaciones recientes), asi corre igual en local y en prod. Solo cambia la
 * cookie de ubicacion del navegador de la prueba; no escribe en la base.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const VILLAHERMOSA = { lat: 17.9892, lng: -92.9281, name: 'Villahermosa', fullName: 'Villahermosa, Tabasco' };
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'vicino_location', value: encodeURIComponent(`${PUEBLA.lat},${PUEBLA.lng}`), url: BASE }]);
  // Cinco recientes: con una sola la hoja no desborda y el header fijo no se
  // pondria a prueba. Villahermosa va al final, para tener que bajar a ella.
  await ctx.addInitScript((reciente) => {
    try {
      if (!localStorage.getItem('vicino_recent_locations')) {
        const otras = [['Mérida', 20.9674, -89.5926], ['Monterrey', 25.6866, -100.3161], ['Oaxaca', 17.0732, -96.7266], ['Querétaro', 20.5888, -100.3899]]
          .map(([name, lat, lng], i) => ({ name, fullName: name, lat, lng, timestamp: Date.now() - (i + 1) * 1000 }));
        localStorage.setItem('vicino_recent_locations', JSON.stringify([...otras, { ...reciente, timestamp: Date.now() - 10_000 }]));
      }
    } catch {}
  }, VILLAHERMOSA);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const hoja = () => page.getByRole('dialog', { name: 'Cambiar ubicación' });
  const boton = () => hoja().locator('button[data-accion]');
  const accion = () => boton().getAttribute('data-accion');
  const esperarAccion = (valor) => page.waitForFunction(
    (v) => document.querySelector('[role="dialog"][aria-label="Cambiar ubicación"] button[data-accion]')?.getAttribute('data-accion') === v,
    valor, { timeout: 10_000 });
  const abrir = async () => {
    await page.locator('button:has(svg.lucide-map-pin)').first().click();
    await hoja().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
  };
  const cookie = async () => {
    const c = (await ctx.cookies()).find((x) => x.name === 'vicino_location');
    return c ? decodeURIComponent(c.value) : '';
  };

  try {
    await page.goto(`${BASE}/`, { timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500); // hidratacion

    await paso('al abrir, arriba a la derecha esta la X (Cerrar) y no hay boton inferior', async () => {
      await abrir();
      if (await accion() !== 'cerrar') throw new Error(`data-accion=${await accion()}`);
      if (await boton().getAttribute('aria-label') !== 'Cerrar') throw new Error('aria-label');
      const inferior = await hoja().locator('button', { hasText: 'Aplicar ubicación' }).count();
      if (inferior) throw new Error('sigue el boton "Aplicar ubicación" del fondo');
    });

    await paso('cambiar el radio convierte la X en palomita; volver al radio de antes devuelve la X', async () => {
      await hoja().locator('select').selectOption('50000');
      await esperarAccion('aplicar');
      if (await boton().getAttribute('aria-label') !== 'Aplicar ubicación') throw new Error('aria-label');
      await page.screenshot({ path: path.join(OUT, 'ubicacion-palomita.png') });
      await hoja().locator('select').selectOption('10000');
      await esperarAccion('cerrar');
    });

    await paso('Escape con cambios pendientes descarta sin aplicar', async () => {
      await hoja().locator('select').selectOption('25000');
      await esperarAccion('aplicar');
      await page.keyboard.press('Escape');
      await hoja().waitFor({ state: 'detached', timeout: 10_000 });
      const c = await cookie();
      if (!c.startsWith(`${PUEBLA.lat}`)) throw new Error(`la cookie cambio: ${c}`);
    });

    await paso('abajo en recientes: el header y la palomita siguen a la vista', async () => {
      await abrir();
      const bajo = await hoja().evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      if (bajo <= 0) throw new Error('la hoja no desborda: el header fijo no se esta probando');
      await page.waitForTimeout(300);
      await hoja().getByRole('button', { name: /Villahermosa/ }).click();
      await esperarAccion('aplicar');
      await page.waitForTimeout(250); // fin de la animacion del icono
      // Visible de verdad: lo que hay en el centro del boton es el boton (o su
      // icono), no el contenido que paso por encima al hacer scroll.
      const visible = await boton().evaluate((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!el && (el === b || b.contains(el));
      });
      if (!visible) throw new Error('la palomita quedo tapada al bajar');
      await page.screenshot({ path: path.join(OUT, 'ubicacion-palomita-scroll.png') });
      return `scrollTop=${bajo}`;
    });

    await paso('la palomita aplica: cierra la hoja y guarda Villahermosa', async () => {
      await boton().click();
      await hoja().waitFor({ state: 'detached', timeout: 10_000 });
      await page.waitForTimeout(1500);
      const [lat, lng] = (await cookie()).split(',').map(Number);
      if (Math.abs(lat - VILLAHERMOSA.lat) > 0.001 || Math.abs(lng - VILLAHERMOSA.lng) > 0.001) throw new Error(`cookie ${await cookie()}`);
      return await cookie();
    });

    await paso('al reabrir: X de nuevo y Villahermosa marcada como ubicacion actual', async () => {
      await abrir();
      if (await accion() !== 'cerrar') throw new Error(`data-accion=${await accion()}`);
      // Exacto y dentro de la fila de Villahermosa: el boton de GPS dice
      // "Usar mi ubicación actual" y daba un falso verde.
      const actual = await hoja().getByRole('button', { name: /Villahermosa/ }).getByText('Ubicación actual', { exact: true }).count();
      if (!actual) throw new Error('Villahermosa no quedo marcada como ubicacion actual');
      await boton().click();
      await hoja().waitFor({ state: 'detached', timeout: 10_000 });
    });

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
  }
  const ok = resultados.filter(Boolean).length;
  console.log(`\nResultado contra ${BASE}: ${ok}/${resultados.length} pasos OK.`);
  process.exitCode = ok === resultados.length ? 0 : 1;
};

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(2); });
