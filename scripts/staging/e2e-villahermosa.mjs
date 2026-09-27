#!/usr/bin/env node
/**
 * PT05 — reporte de Javier: "al buscar Villahermosa, Tabasco, no aparece la
 * opcion para cambiar la ubicacion". Visitante sin sesion: abre "Cambiar
 * ubicacion" en Home, busca ciudades fuera de 200 km de Puebla y comprueba que
 * aparecen, que se pueden aplicar y que la ubicacion queda guardada.
 *
 *   E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-villahermosa.mjs
 *
 * Solo lectura: no escribe en la base; lo unico que cambia es la cookie de
 * ubicacion del navegador de la prueba. MapKit necesita las claves de Apple,
 * que solo tiene el despliegue de Vercel: por eso corre contra una URL real.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'https://vicinomarket.com';
const OUT = path.join(CONFIG_DIR, 'e2e');
const CIUDADES = (process.env.E2E_CIUDADES || 'Villahermosa|Mérida|Monterrey').split('|');
// La cookie guarda "lat,lng,..." y no el nombre: se comprueba que el punto
// guardado caiga a menos de 30 km del centro de la ciudad buscada.
const CENTROS = {
  Villahermosa: [17.9892, -92.9281],
  'Mérida': [20.9674, -89.5926],
  Monterrey: [25.6866, -100.3161],
};
const kmEntre = ([a, b], [c, d]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  let fallos = 0;
  try {
    await page.goto(`${BASE}/`, { timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    for (const ciudad of CIUDADES) {
      await page.locator('button:has(svg.lucide-map-pin)').first().click();
      const input = page.getByPlaceholder('Buscar zona, colonia o dirección…');
      await input.waitFor({ timeout: 30_000 });
      await input.fill('');
      await input.fill(ciudad);
      const dialogo = page.getByRole('dialog').last();
      const resultado = dialogo.locator('button').filter({ hasText: new RegExp(ciudad.slice(0, 5), 'i') }).first();
      const aviso = dialogo.getByText(/fuera de la zona donde VICINO opera|fuera de México/);
      const hubo = await Promise.race([
        resultado.waitFor({ timeout: 15_000 }).then(() => 'resultado'),
        aviso.waitFor({ timeout: 15_000 }).then(() => 'aviso'),
      ]).catch(() => 'nada');
      if (hubo !== 'resultado') {
        fallos++;
        const texto = hubo === 'aviso' ? await aviso.innerText() : 'sin resultados ni aviso';
        console.log(`  FALLO ${ciudad}: ${texto}`);
        await page.screenshot({ path: path.join(OUT, `ubicacion-${ciudad}.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        continue;
      }
      await resultado.click();
      const aplicar = dialogo.getByRole('button', { name: 'Aplicar ubicación' });
      await aplicar.waitFor({ timeout: 10_000 });
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Aplicar ubicación'));
        return b && !b.hasAttribute('disabled');
      }, null, { timeout: 15_000 });
      await aplicar.click();
      await page.waitForTimeout(2500);
      const cookie = (await ctx.cookies()).find((c) => c.name === 'vicino_location');
      const guardada = cookie ? decodeURIComponent(cookie.value) : '';
      const [lat, lng] = guardada.split(',').map(Number);
      const centro = CENTROS[ciudad];
      const ok = centro ? Number.isFinite(lat) && Number.isFinite(lng) && kmEntre([lat, lng], centro) < 30
        : new RegExp(ciudad.slice(0, 5), 'i').test(guardada);
      if (!ok) fallos++;
      console.log(`  ${ok ? 'OK   ' : 'FALLO'} ${ciudad}: aparece, se aplica y la cookie guarda ${guardada.slice(0, 90)}`);
      await page.screenshot({ path: path.join(OUT, `ubicacion-${ciudad}.png`) });
    }
  } finally {
    await browser.close();
  }
  console.log(`\nResultado contra ${BASE}: ${CIUDADES.length - fallos}/${CIUDADES.length} ciudades OK.`);
  process.exitCode = fallos ? 1 : 0;
};

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(2); });
