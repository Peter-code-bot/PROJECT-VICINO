#!/usr/bin/env node
/**
 * Modo campus de Home (S09-A, definicion de Javier del 26-sep): el chip
 * "Comunidad Universitaria" va primero; al seleccionarlo SOLO se ven
 * publicaciones de la universidad del usuario, y combinado con otra categoria
 * es la interseccion dentro de la universidad, nunca la fila general.
 *
 *   node scripts/staging/e2e-campus-home.mjs   (web local :3100 contra staging)
 *
 * Fixtures sinteticos (@staging.vicino.test): dos universidades, un vendedor
 * sin universidad y un estudiante sin companeros. Se retiran al final.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR, sql } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, leer, limpiar, DOMINIO } from './fixtures.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const UNI_A = 'Universidad Anáhuac';
const UNI_B = 'UDLAP';
const UNI_VACIA = 'BUAP';
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};

const producto = (creador, titulo, cat) => sql(cfg.ref, `insert into public.products_services
  (creador_id, titulo, descripcion, categoria, precio, estatus, ubicacion_geo)
  values (${q(creador)}, ${q(`[FIXTURE] ${titulo}`)}, 'Producto sintetico', ${q(cat)}, 120, 'disponible',
          ST_SetSRID(ST_MakePoint(-98.2063, 19.0414), 4326)::geography)`);

const credencial = (id, universidad) => sql(cfg.ref, `insert into public.seller_verification
  (user_id, status, document_type, university_name, ine_front_url, ine_back_url, selfie_url, submitted_at, reviewed_at)
  values (${q(id)}, 'approved', 'Credencial Universitaria', ${q(universidad)},
          'fixture/frente.jpg', 'fixture/reverso.jpg', 'fixture/selfie.jpg', now(), now())`);
// (rutas sinteticas: el guard exige los tres documentos para aprobar; no hay archivos detras)

const usuario = async (etiqueta, { vendedor = false, universidad = null } = {}) => {
  const u = await crearUsuario(cfg, etiqueta);
  await completarOnboarding(cfg, u.id);
  if (vendedor) await sql(cfg.ref, `update public.profiles set es_vendedor = true where id = ${q(u.id)}`);
  if (universidad) await credencial(u.id, universidad);
  return u;
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

const retirarCredenciales = () => sql(cfg.ref, `delete from public.seller_verification
  where user_id in (select id from auth.users where email like ${q(`%@${DOMINIO}`)})`);

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const [c1, c2] = await leer(cfg, 'select slug from public.categories order by slug limit 2');
  const T = {
    uniA1: `CAMPUS-A ${c1.slug}`, uniA2: `CAMPUS-A ${c2.slug}`,
    uniB: `CAMPUS-B ${c1.slug}`, general1: `GENERAL ${c1.slug}`, general2: `GENERAL ${c2.slug}`,
  };
  const vA = await usuario('campus-vend-a', { vendedor: true, universidad: UNI_A });
  const vB = await usuario('campus-vend-b', { vendedor: true, universidad: UNI_B });
  const vG = await usuario('campus-vend-general', { vendedor: true });
  const lectorA = await usuario('campus-lector-a', { universidad: UNI_A });
  const lectorB = await usuario('campus-lector-b', { universidad: UNI_B });
  const lectorVacio = await usuario('campus-lector-vacio', { universidad: UNI_VACIA });
  await producto(vA.id, T.uniA1, c1.slug);
  await producto(vA.id, T.uniA2, c2.slug);
  await producto(vB.id, T.uniB, c1.slug);
  await producto(vG.id, T.general1, c1.slug);
  await producto(vG.id, T.general2, c2.slug);

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  const nueva = async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errores.push(e.message));
    return page;
  };
  const visibles = async (page) => {
    const texto = await page.locator('main').innerText();
    return Object.fromEntries(Object.entries(T).map(([k, t]) => [k, texto.includes(`[FIXTURE] ${t}`)]));
  };
  const exigir = (v, si, no) => {
    const faltan = si.filter((k) => !v[k]);
    const sobran = no.filter((k) => v[k]);
    if (faltan.length || sobran.length) throw new Error(`faltan [${faltan}] sobran [${sobran}]`);
  };
  const chip = (page, slug) => page.locator(`#cat-${slug}`);
  const tocar = async (page, slug) => {
    const antes = await chip(page, slug).getAttribute('aria-pressed');
    await chip(page, slug).click();
    await page.waitForFunction(([id, antes]) => document.getElementById(id)?.getAttribute('aria-pressed') !== antes,
      [`cat-${slug}`, antes], { timeout: 5_000 });
    await page.waitForTimeout(300);
  };
  const home = async (page, query = '') => {
    await page.goto(`${BASE}/${query}`, { timeout: 180_000 });
    await page.locator('section[aria-label="Categorías del inicio"]').waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500); // hidratacion
  };

  try {
    const pV = await nueva();
    await paso('visitante: sin chip universitario y ?cats=universidad no filtra', async () => {
      await home(pV, '?cats=universidad');
      if (await chip(pV, 'universidad').count()) throw new Error('el visitante ve el chip');
      exigir(await visibles(pV), ['general1'], []);
    });

    const pA = await nueva();
    await paso('estudiante A: login real', async () => { await login(pA, lectorA); });
    await paso('chip universitario primero y sin seleccionar', async () => {
      await home(pA);
      const primero = await pA.locator('section[aria-label="Categorías del inicio"] button[aria-pressed]').first().getAttribute('id');
      if (primero !== 'cat-universidad') throw new Error(`primer chip: ${primero}`);
      if (await chip(pA, 'universidad').getAttribute('aria-pressed') !== 'false') throw new Error('arranca seleccionado');
    });
    await paso('seleccionar Universidad: solo su universidad, en Home', async () => {
      await tocar(pA, 'universidad');
      const url = new URL(pA.url());
      if (url.pathname !== '/' || url.searchParams.get('cats') !== 'universidad') throw new Error(`url ${url.pathname}${url.search}`);
      exigir(await visibles(pA), ['uniA1', 'uniA2'], ['uniB', 'general1', 'general2']);
    });
    await paso(`Universidad + ${c1.slug}: interseccion, sin filas generales`, async () => {
      await tocar(pA, c1.slug);
      exigir(await visibles(pA), ['uniA1'], ['uniA2', 'uniB', 'general1', 'general2']);
    });
    await paso('recargar con la URL conserva el modo campus', async () => {
      await home(pA, `?cats=universidad,${c1.slug}`);
      exigir(await visibles(pA), ['uniA1'], ['uniA2', 'uniB', 'general1', 'general2']);
    });
    await paso('quitar Universidad devuelve el contenido general', async () => {
      await tocar(pA, 'universidad');
      exigir(await visibles(pA), ['general1'], []);
    });
    await paso('/buscar?category=universidad: mismo ambito', async () => {
      await pA.goto(`${BASE}/buscar?category=universidad`, { timeout: 180_000 });
      await pA.waitForTimeout(2500);
      exigir(await visibles(pA), ['uniA1', 'uniA2'], ['uniB', 'general1', 'general2']);
    });

    const pB = await nueva();
    await paso('estudiante B (otra universidad): solo la suya', async () => {
      await login(pB, lectorB);
      await home(pB, '?cats=universidad');
      exigir(await visibles(pB), ['uniB'], ['uniA1', 'uniA2', 'general1', 'general2']);
    });

    const pZ = await nueva();
    await paso('universidad sin publicaciones: aviso, no catalogo general', async () => {
      await login(pZ, lectorVacio);
      await home(pZ, '?cats=universidad');
      exigir(await visibles(pZ), [], ['uniA1', 'uniA2', 'uniB', 'general1', 'general2']);
      const aviso = await pZ.getByRole('status').filter({ hasText: UNI_VACIA }).count();
      if (!aviso) throw new Error('sin aviso de vacio');
    });
    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
    await pA.screenshot({ path: path.join(OUT, 'campus-home.png') }).catch(() => {});
  } finally {
    await browser.close();
    await retirarCredenciales();
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length ? 0 : 1;
  }
};

main().catch(async (e) => {
  console.error(`ERROR: ${e.message}`);
  try { await retirarCredenciales(); await limpiar(cfg); } catch {}
  process.exit(2);
});
