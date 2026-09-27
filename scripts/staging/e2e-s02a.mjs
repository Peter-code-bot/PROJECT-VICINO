#!/usr/bin/env node
/**
 * VAL-S02A-staging: validacion funcional de S02-A (registro y sesion) con la
 * web local (:3100) contra el staging. Contrato en Notion, «Actualizacion
 * S02-A — 24-sep-2026» y «D02-S02-A».
 *
 *   node scripts/staging/e2e-s02a.mjs
 *
 * No manda correos: el alta se prueba con un correo que YA tiene cuenta (GoTrue
 * no envia nada y devuelve una respuesta sin sesion), que es justo el P0
 * «Registro con correo existente». La entrega real del codigo depende de
 * PT04-SMTP y no se prueba aqui. Fixtures @staging.vicino.test; se retiran.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const cfg = staging();
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const destino = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
// Solo la cookie de sesion (entera o partida en .0/.1). La del PKCE
// (`-auth-token-code-verifier`) la pone el alta sin que haya sesion.
const haySesion = async (ctx) => (await ctx.cookies()).some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value);

/** Entra por /login (con el reintento por hidratacion) y espera salir de /login. */
const entrar = async (page, u, next) => {
  await page.goto(`${BASE}/login${next !== undefined ? `?next=${encodeURIComponent(next)}` : ''}`, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  return destino(page);
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const existente = await crearUsuario(cfg, 's02a-existente');
  await completarOnboarding(cfg, existente.id);

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  const nueva = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    return { ctx, page };
  };
  try {
    const { ctx: ctxV, page: v } = await nueva();

    await paso('Registro con correo YA registrado: pantalla neutral, sin sesion y sin delatar la cuenta', async () => {
      await v.goto(`${BASE}/register?next=${encodeURIComponent('/buscar?q=mesa')}`, { timeout: 180_000 });
      await v.locator('#email').waitFor({ timeout: 60_000 });
      await v.waitForTimeout(1500);
      await v.locator('#nombre').fill('Prueba S02A');
      await v.locator('#email').fill(existente.email);
      await v.locator('#password').fill('Staging-S02a-2026!x');
      await v.locator('button[type="submit"]').first().click();
      await v.getByRole('heading', { name: 'Revisa tu correo' }).waitFor({ timeout: 30_000 });
      const texto = (await v.locator('body').innerText()).toLowerCase();
      for (const delator of ['ya está registrado', 'ya existe', 'already registered', 'ya tiene cuenta']) {
        if (texto.includes(delator)) throw new Error(`delata la cuenta: «${delator}»`);
      }
      if (await haySesion(ctxV)) throw new Error(`se creo una sesion: ${(await ctxV.cookies()).map((c) => c.name).join(', ')}`);
      // Prueba de verdad: una ruta que exige sesion manda a /login.
      const sonda = await ctxV.newPage();
      await sonda.goto(`${BASE}/favoritos`, { timeout: 180_000 });
      await sonda.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
      const conSesion = !new URL(sonda.url()).pathname.startsWith('/login');
      await sonda.close();
      if (conSesion) throw new Error('/favoritos abrio sin pedir login: hay sesion');
      await v.screenshot({ path: path.join(OUT, 's02a-correo-existente.png') });
    });

    await paso('La pantalla neutral ofrece Iniciar sesion (conservando next), Recuperar contrasena y Cambiar correo', async () => {
      const login = v.getByRole('link', { name: 'Iniciar sesión' });
      const href = await login.getAttribute('href');
      if (!href?.startsWith('/login') || !decodeURIComponent(href).includes('/buscar?q=mesa')) throw new Error(`Iniciar sesión → ${href}`);
      const forgot = await v.getByRole('link', { name: 'Recuperar contraseña' }).getAttribute('href');
      if (!forgot) throw new Error('sin Recuperar contraseña');
      await v.getByRole('button', { name: 'Cambiar correo' }).click();
      await v.locator('#email').waitFor({ timeout: 10_000 });
      return `login=${href} · forgot=${forgot}`;
    });

    await paso('Iniciar sesion desde ahi respeta next=/buscar?q=mesa', async () => {
      const d = await entrar(v, existente, '/buscar?q=mesa');
      if (d !== '/buscar?q=mesa') throw new Error(`fue a ${d}`);
      if (!(await haySesion(ctxV))) throw new Error('sin sesion');
      return d;
    });

    await paso('Con sesion, /register no da otra alta: sale de /register y conserva la sesion', async () => {
      await v.goto(`${BASE}/register`, { timeout: 180_000 });
      await v.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 30_000 });
      if (!(await haySesion(ctxV))) throw new Error('perdio la sesion');
      return destino(v);
    });

    await paso('Con sesion, /login tambien sale y conserva la sesion', async () => {
      await v.goto(`${BASE}/login?next=${encodeURIComponent('/favoritos')}`, { timeout: 180_000 });
      await v.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
      if (!(await haySesion(ctxV))) throw new Error('perdio la sesion');
      return destino(v);
    });
    await ctxV.close();

    for (const [nombre, next] of [['externo //evil.example', '//evil.example/x'], ['bucle /register', '/register'], ['https externo', 'https://evil.example/']]) {
      await paso(`next malicioso (${nombre}) cae en Inicio tras entrar`, async () => {
        const { ctx, page } = await nueva();
        const d = await entrar(page, existente, next);
        await ctx.close();
        if (d !== '/') throw new Error(`fue a ${d}`);
        return d;
      });
    }

    await paso('Contrasena incorrecta: se queda en /login con un error y sin sesion', async () => {
      const { ctx, page } = await nueva();
      await page.goto(`${BASE}/login`, { timeout: 180_000 });
      await page.waitForTimeout(1500);
      await page.locator('#email').fill(existente.email);
      await page.locator('#password').fill('incorrecta-123456');
      await page.locator('button[type="submit"]').first().click();
      await page.getByRole('alert').first().waitFor({ timeout: 20_000 });
      const sigue = new URL(page.url()).pathname.startsWith('/login');
      const sesion = await haySesion(ctx);
      await ctx.close();
      if (!sigue || sesion) throw new Error(`url=${page.url()} sesion=${sesion}`);
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
