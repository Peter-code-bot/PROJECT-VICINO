#!/usr/bin/env node
/**
 * E2E-chat-lotes: recuperacion del chat cuando el hueco es MAYOR que un lote.
 *
 * reconciliarChat (lib/realtime/reconciliar-chat.ts) trae el intervalo perdido
 * en paginas de 100, como mucho 10 por vuelta. Con un hueco de mas de 1000
 * mensajes la vuelta termina con intervalo pendiente y la UI dice «Hay mensajes
 * pendientes de recuperar.» con el boton «Cargar mensajes pendientes», que
 * continua desde el cursor sin saltarse nada.
 *
 * El hueco se fabrica con el navegador SIN RED (context.setOffline): mientras
 * tanto se insertan 1150 mensajes por SQL. Al volver la red, el canal
 * reconecta y reconcilia.
 *
 *   node scripts/staging/e2e-chat-lotes.mjs   (web local :3100 contra staging)
 *
 * Solo staging: los triggers de messages alli son locales (sin HTTP). Fixtures
 * @staging.vicino.test; se retiran al final.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR, sql } from './lib.mjs';
import { staging, rpc, crearUsuario, crearProducto, completarOnboarding, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const HUECO = 1150;
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const login = async (page, u) => {
  await page.goto(`${BASE}/login`, { timeout: 180_000 });
  await page.waitForLoadState('load');
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('form button[type=submit]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const V = await crearUsuario(cfg, 'lotes-vendedor');
  const C = await crearUsuario(cfg, 'lotes-comprador');
  await completarOnboarding(cfg, V.id);
  await completarOnboarding(cfg, C.id);
  const P = await crearProducto(cfg, V.id, { titulo: 'Lotes E2E', precio: 100 });
  const chatR = await rpc(cfg, C.token, 'get_or_create_chat', { p_comprador_id: C.id, p_vendedor_id: V.id, p_producto_id: P });
  if (chatR.status !== 200) throw new Error(`chat: ${JSON.stringify(chatR.body)}`);
  const chat = chatR.body;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const estado = page.locator('[role="status"]').filter({ hasText: /Recuperando|pendientes de recuperar|Sincronización pendiente/ });
  const contarLote = () => page.locator('[data-message-id]', { hasText: /^lote \d+/ }).count();
  const numerosLote = () => page.locator('[data-message-id]').evaluateAll((els) =>
    els.map((e) => (e.textContent || '').match(/lote (\d+)/)).filter(Boolean).map((m) => Number(m[1])));

  try {
    await paso('el comprador abre el chat y queda sincronizado', async () => {
      await login(page, C);
      await page.goto(`${BASE}/chat/${chat}`, { timeout: 180_000 });
      await page.getByPlaceholder('Escribe un mensaje...').waitFor({ timeout: 120_000 });
      await estado.waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
      if (await estado.count()) throw new Error(`estado: ${await estado.innerText()}`);
    });

    await paso(`sin red, llegan ${HUECO} mensajes (hueco mayor que 10 paginas de 100)`, async () => {
      await ctx.setOffline(true);
      await page.waitForTimeout(1500);
      await sql(cfg.ref, `insert into public.messages (chat_id, autor_id, texto, created_at)
        select ${q(chat)}, ${q(V.id)}, 'lote ' || g, now() + (g || ' milliseconds')::interval
        from generate_series(1, ${HUECO}) g`);
      const [r] = await sql(cfg.ref, `select count(*)::int n from public.messages where chat_id = ${q(chat)} and texto like 'lote %'`);
      if (r.n !== HUECO) throw new Error(`insertados ${r.n}`);
      return `${r.n} en la base`;
    });

    await paso('al volver la red: «Hay mensajes pendientes de recuperar» con «Cargar mensajes pendientes»', async () => {
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.getByText('Hay mensajes pendientes de recuperar.').waitFor({ timeout: 90_000 });
      await page.getByRole('button', { name: 'Cargar mensajes pendientes' }).waitFor({ timeout: 5_000 });
      await page.screenshot({ path: path.join(OUT, 'chat-lotes-pendientes.png') });
      return `${await contarLote()} de ${HUECO} en pantalla`;
    });

    await paso('«Cargar mensajes pendientes» termina de recuperar: estado sincronizado y los 1150 sin huecos', async () => {
      for (let i = 0; i < 5; i++) {
        const boton = page.getByRole('button', { name: 'Cargar mensajes pendientes' });
        if (!(await boton.count())) break;
        await boton.click();
        await page.waitForFunction(() => !document.body.innerText.includes('Recuperando conversación'), null, { timeout: 90_000 });
      }
      await estado.waitFor({ state: 'detached', timeout: 60_000 });
      const nums = [...new Set(await numerosLote())].sort((a, b) => a - b);
      const faltan = [];
      for (let i = 1; i <= HUECO; i++) if (!nums.includes(i)) faltan.push(i);
      if (faltan.length) throw new Error(`faltan ${faltan.length} (p. ej. ${faltan.slice(0, 5).join(',')})`);
      return `${nums.length}/${HUECO} sin huecos`;
    });

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
    await sql(cfg.ref, `delete from public.messages where chat_id = ${q(chat)}`);
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length && n === 0 ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
