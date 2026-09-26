#!/usr/bin/env node
/**
 * PT03 — recorrido real de chat y venta con DOS sesiones en navegador contra
 * el STAGING: web local (dev-contra-staging.mjs en :3100) + Supabase de
 * staging con Realtime alojado. Lo que ni PGlite ni las pruebas de componente
 * con servidor simulado pueden acreditar.
 *
 *   node scripts/staging/dev-contra-staging.mjs      # en otra terminal
 *   node scripts/staging/e2e-chat-venta.mjs [--ver]  # --ver: navegador visible
 *
 * Crea usuarios y productos sinteticos y los retira al final. Capturas en
 * .staging/e2e/.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, rpc, crearUsuario, crearProducto, completarOnboarding, leer, limpiar } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const errores = [];

const paso = async (nombre, fn) => {
  const t0 = Date.now();
  try {
    const d = await fn();
    resultados.push({ nombre, ok: true });
    console.log(`  OK   ${nombre} (${((Date.now() - t0) / 1000).toFixed(1)}s)${d ? ` — ${d}` : ''}`);
  } catch (e) {
    resultados.push({ nombre, ok: false, error: e.message });
    console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`);
  }
};

const login = async (page, u) => {
  await page.goto(`${BASE}/login`, { timeout: 180_000 });
  await page.waitForLoadState('load');
  // Un clic anterior a la hidratacion se pierde en silencio: reintentar hasta
  // salir de /login, sin confiar en un solo intento.
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('form button[type=submit]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

const abrirChat = async (page, chat) => {
  await page.goto(`${BASE}/chat/${chat}`, { timeout: 180_000 });
  await page.getByPlaceholder('Escribe un mensaje...').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500); // suscripcion Realtime
};

const enviar = async (page, texto) => {
  const input = page.getByPlaceholder('Escribe un mensaje...');
  await input.fill(texto);
  await input.press('Enter');
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`E2E contra ${BASE} (staging ${cfg.ref}) — fixtures...`);
  const V = await crearUsuario(cfg, 'e2e-vendedor');
  const C = await crearUsuario(cfg, 'e2e-comprador');
  await completarOnboarding(cfg, V.id);
  await completarOnboarding(cfg, C.id);
  const P1 = await crearProducto(cfg, V.id, { titulo: 'Mesa E2E', precio: 150 });
  const P2 = await crearProducto(cfg, V.id, { titulo: 'Silla E2E', precio: 90 });
  const chatR = await rpc(cfg, C.token, 'get_or_create_chat', { p_comprador_id: C.id, p_vendedor_id: V.id, p_producto_id: P1 });
  if (chatR.status !== 200) throw new Error(`chat: ${JSON.stringify(chatR.body)}`);
  const chat = chatR.body;

  const browser = await chromium.launch({ headless: !process.argv.includes('--ver') });
  const ctxV = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'es-MX' });
  const ctxC = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'es-MX' });
  const pV = await ctxV.newPage();
  const pC = await ctxC.newPage();
  for (const [quien, p] of [['vendedor', pV], ['comprador', pC]]) {
    p.on('pageerror', (e) => errores.push(`${quien}: ${e.message}`));
  }
  console.log('Pasos:');

  try {
    await paso('1 login real de las dos cuentas', async () => { await login(pV, V); await login(pC, C); });
    await paso('2 ambos abren el mismo chat', async () => { await abrirChat(pV, chat); await abrirChat(pC, chat); });

    const hola = `hola E2E ${crypto.randomBytes(3).toString('hex')}`;
    await paso('3 mensaje del comprador llega al vendedor en tiempo real', async () => {
      await enviar(pC, hola);
      await pV.getByText(hola).first().waitFor({ timeout: 20_000 });
    });

    await paso('4 el comprador cambia el producto y el vendedor lo ve sin recargar', async () => {
      await pC.getByRole('button', { name: /Cambiar producto|Elegir producto/ }).click();
      const select = pC.getByRole('combobox', { name: 'Producto de la conversación', exact: true });
      await select.waitFor({ timeout: 30_000 });
      await select.selectOption(P2);
      await pC.getByRole('button', { name: 'Aplicar producto' }).click();
      await pV.getByText('[FIXTURE] Silla E2E').first().waitFor({ timeout: 20_000 });
      const [c] = await leer(cfg, `select ultimo_producto_id, producto_revision from chats where id = ${q(chat)}`);
      if (c.ultimo_producto_id !== P2) throw new Error(`producto en BD ${c.ultimo_producto_id}`);
      return `revision ${c.producto_revision}`;
    });

    await paso('5 el comprador inicia la venta y el vendedor la recibe', async () => {
      await pC.getByRole('button', { name: 'Confirmar Venta', exact: true }).click();
      const precio = pC.locator('#sale-price');
      await precio.waitFor({ timeout: 20_000 });
      await precio.fill('85');
      await pC.getByRole('button', { name: 'Iniciar Confirmación' }).click();
      await pV.getByText('Pendiente de respuesta del vendedor').first().waitFor({ timeout: 25_000 });
      const [s] = await leer(cfg, `select count(*)::int n from sale_confirmations where chat_id = ${q(chat)} and status = 'pending_confirmation'`);
      if (s.n !== 1) throw new Error(`ventas pendientes en BD: ${s.n}`);
    });

    await paso('6 el vendedor confirma: completada una vez, avisos sin duplicar', async () => {
      // La tarjeta llega colapsada; el boton vive dentro de "Ver detalles".
      await pV.getByRole('button', { name: /Ver detalles/ }).first().click();
      await pV.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
      // Etiqueta exacta de la tarjeta; el aviso automatico dice "¡Venta confirmada en VICINO!…" y no cuenta.
      await pV.getByText('Venta confirmada', { exact: true }).first().waitFor({ timeout: 25_000 });
      await pC.getByText('Venta confirmada', { exact: true }).first().waitFor({ timeout: 25_000 });
      const [d] = await leer(cfg, `select
        (select count(*)::int from sale_confirmations where chat_id = ${q(chat)}) ventas,
        (select string_agg(status::text, ',') from sale_confirmations where chat_id = ${q(chat)}) estados,
        (select precio_acordado from sale_confirmations where chat_id = ${q(chat)} limit 1) precio,
        (select count(*)::int from messages where chat_id = ${q(chat)} and message_type = 'sale_proposed') propuestas,
        (select count(*)::int from messages where chat_id = ${q(chat)} and message_type = 'sale_confirmed') confirmadas`);
      if (d.ventas !== 1 || d.estados !== 'completed' || Number(d.precio) !== 85 || d.propuestas !== 1 || d.confirmadas !== 1) {
        throw new Error(JSON.stringify(d));
      }
      return 'venta completed a $85, 1 propuesta, 1 confirmacion';
    });

    const sinRed = `mensaje sin red ${crypto.randomBytes(3).toString('hex')}`;
    await paso('7 el vendedor pierde la red, llega un mensaje, recupera la red y lo ve una vez', async () => {
      await ctxV.setOffline(true);
      await pV.waitForTimeout(2500);
      await enviar(pC, sinRed);
      await pC.getByText(sinRed).first().waitFor({ timeout: 15_000 });
      await pV.waitForTimeout(4000);
      await ctxV.setOffline(false);
      await pV.getByText(sinRed).first().waitFor({ timeout: 45_000 });
      await pV.waitForTimeout(3000);
      const n = await pV.getByText(sinRed).count();
      if (n !== 1) throw new Error(`aparece ${n} veces`);
    });

    await paso('8 el vendedor responde tras reconectar y el comprador lo recibe', async () => {
      const resp = `respuesta ${crypto.randomBytes(3).toString('hex')}`;
      await enviar(pV, resp);
      try {
        await pC.getByText(resp).first().waitFor({ timeout: 20_000 });
      } catch (e) {
        const [m] = await leer(cfg, `select count(*)::int n from messages where chat_id = ${q(chat)} and texto = ${q(resp)}`);
        const enV = await pV.getByText(resp).count();
        throw new Error(`no llego al comprador; en BD: ${m.n}, visible en el vendedor: ${enV}`);
      }
    });
    await paso('9 ningun aviso de sincronizacion se queda pegado', async () => {
      const aviso = /Recuperando conversación|Sincronización pendiente|mensajes pendientes de recuperar/;
      for (const [quien, p] of [['vendedor', pV], ['comprador', pC]]) {
        await p.waitForFunction((src) => !new RegExp(src).test(document.body.innerText), aviso.source, { timeout: 30_000 })
          .catch(async () => { const t = (await p.getByRole('status').allInnerTexts()).join(' | '); throw new Error(`${quien} sigue con: ${t}`); });
      }
    });
  } finally {
    await pV.screenshot({ path: path.join(OUT, 'vendedor.png'), fullPage: false }).catch(() => {});
    await pC.screenshot({ path: path.join(OUT, 'comprador.png'), fullPage: false }).catch(() => {});
    await browser.close();
    const quedan = await limpiar(cfg);
    const fallos = resultados.filter((r) => !r.ok);
    if (errores.length) console.log(`\nErrores de pagina (${errores.length}):\n  ${errores.slice(0, 10).join('\n  ')}`);
    console.log(`\nResultado: ${resultados.length - fallos.length}/${resultados.length} pasos OK. Fixtures restantes: ${quedan}. Capturas en .staging/e2e/`);
    process.exitCode = fallos.length ? 1 : 0;
  }
};

main().catch(async (e) => {
  console.error(`ERROR: ${e.message}`);
  try { await limpiar(cfg); } catch {}
  process.exit(2);
});
