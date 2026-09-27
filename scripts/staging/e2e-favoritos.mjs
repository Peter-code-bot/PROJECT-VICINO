#!/usr/bin/env node
/**
 * S03 / PT02 (pendiente VAL-S03-favoritos): Favoritos con roles reales.
 *
 * Un comprador tiene en favoritos tres publicaciones de otro vendedor:
 * disponible, pausada y eliminada. Se comprueba que:
 *   - la disponible sale como tarjeta normal, con enlace a su ficha;
 *   - la pausada y la eliminada salen como tarjeta inactiva SIN enlace (antes
 *     llevaban a un 404). OJO, hallazgo del 27-sep: la RLS de products_services
 *     solo deja ver `disponible` a quien no es el dueno, asi que al comprador la
 *     pausada le llega como fila nula y sale «Publicación no disponible», sin
 *     titulo ni foto; el motivo «Pausado por el vendedor» nunca se ve. La prueba
 *     registra que motivo sale en vez de exigir uno;
 *   - la pausada no esta en el catalogo (/buscar) y su ficha no permite comprar;
 *   - «Quitar de favoritos» en una inactiva la retira de la base.
 *
 *   node scripts/staging/e2e-favoritos.mjs   (web local :3100 contra staging)
 *
 * Fixtures sinteticos (@staging.vicino.test); se retiran al final.
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
const SEL_INACTIVAS = '[role="region"][aria-label$="(No disponible)"], [role="region"][aria-label$="(Pausado)"]';
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

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const marca = crypto.randomBytes(3).toString('hex');
  const vendedor = await crearUsuario(cfg, 'fav-vendedor');
  await completarOnboarding(cfg, vendedor.id);
  await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(vendedor.id)}`);
  const comprador = await crearUsuario(cfg, 'fav-comprador');
  await completarOnboarding(cfg, comprador.id);

  const titulo = (t) => `${t} ${marca}`;
  const idDisponible = await crearProducto(cfg, vendedor.id, { titulo: titulo('Disponible') });
  const idPausado = await crearProducto(cfg, vendedor.id, { titulo: titulo('Pausado') });
  const idEliminado = await crearProducto(cfg, vendedor.id, { titulo: titulo('Eliminado') });
  // Primero los favoritos, con todo disponible (como en la vida real); despues
  // el vendedor pausa y elimina.
  await sql(cfg.ref, `insert into public.favorites (usuario_id, producto_id)
    values (${q(comprador.id)}, ${q(idDisponible)}), (${q(comprador.id)}, ${q(idPausado)}), (${q(comprador.id)}, ${q(idEliminado)})`);
  await sql(cfg.ref, `update public.products_services set estatus = 'pausado' where id = ${q(idPausado)};
                      update public.products_services set estatus = 'eliminado' where id = ${q(idEliminado)};`);
  const [pausado] = await sql(cfg.ref, `select categoria, slug from public.products_services where id = ${q(idPausado)}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  try {
    await paso('login real del comprador', () => login(page, comprador));

    await paso('Favoritos: la disponible es tarjeta normal con enlace a su ficha', async () => {
      await page.goto(`${BASE}/favoritos`, { timeout: 180_000 });
      await page.getByRole('heading', { name: 'Mis favoritos' }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      const enlace = page.locator('a', { hasText: titulo('Disponible') });
      if (await enlace.count() === 0) throw new Error('la disponible no tiene enlace');
      await page.screenshot({ path: path.join(OUT, 'favoritos-mixtos.png'), fullPage: true });
    });

    await paso('Favoritos: pausada y eliminada son tarjetas inactivas SIN enlace', async () => {
      const inactivas = page.locator(SEL_INACTIVAS);
      if (await inactivas.count() !== 2) throw new Error(`inactivas: ${await inactivas.count()}`);
      if (await inactivas.locator('a').count() !== 0) throw new Error('una inactiva lleva enlace');
      for (const t of ['Pausado', 'Eliminado']) {
        if (await page.locator('a', { hasText: titulo(t) }).count() !== 0) throw new Error(`hay un enlace a la ${t}`);
      }
      return (await inactivas.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).join(' | ');
    });

    await paso('Catalogo: /buscar trae la disponible y no la pausada', async () => {
      await page.goto(`${BASE}/buscar?q=${encodeURIComponent(marca)}`, { timeout: 180_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const texto = await page.locator('main').innerText();
      if (!texto.includes(titulo('Disponible'))) throw new Error('no aparece la disponible');
      if (texto.includes(titulo('Pausado'))) throw new Error('la pausada sigue en el catalogo');
    });

    await paso('Ficha de la pausada: no permite comprar', async () => {
      const res = await page.goto(`${BASE}/${pausado.categoria}/${pausado.slug}`, { timeout: 180_000 });
      await page.waitForTimeout(1500);
      // Con loading.tsx la respuesta ya empezo a transmitirse cuando la pagina
      // llama a notFound(), asi que el 404 llega como 200 con la pantalla 404
      // (soft 404). Las dos formas cuentan como «fuera para quien no es el dueno».
      if (res.status() === 404 || (await page.getByRole('heading', { name: '404', exact: true }).count()) > 0) {
        return `404 (${res.status() === 404 ? 'status' : 'soft, status 200'}): fuera para quien no es el dueno`;
      }
      const deshabilitado = page.getByRole('button', { name: /Publicación pausada/ });
      if (await deshabilitado.count() === 0) throw new Error(`status ${res.status()} sin el aviso de pausada`);
      const comprar = page.getByRole('button', { name: /Comprar|Confirmar compra/ });
      if (await comprar.count() > 0 && await comprar.first().isEnabled()) throw new Error('hay un boton de compra activo');
      return 'aviso «Publicación pausada» y sin compra';
    });

    await paso('Quitar de favoritos una inactiva la retira de la pantalla y de la base', async () => {
      await page.goto(`${BASE}/favoritos`, { timeout: 180_000 });
      await page.getByRole('heading', { name: 'Mis favoritos' }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      const contar = async () => (await sql(cfg.ref, `select count(*)::int n from public.favorites where usuario_id = ${q(comprador.id)}`))[0].n;
      const antes = await contar();
      await page.locator(SEL_INACTIVAS).first().getByRole('button', { name: 'Quitar de favoritos' }).click();
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, SEL_INACTIVAS, { timeout: 15_000 });
      const despues = await contar();
      if (despues !== antes - 1) throw new Error(`favorites ${antes} -> ${despues}`);
      return `favorites ${antes} -> ${despues}`;
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
