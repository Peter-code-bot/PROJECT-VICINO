#!/usr/bin/env node
/**
 * S02B-matriz-acceso: matriz de acceso por estado con la web local (:3100)
 * contra el staging, rutas exentas, GPS denegado en el onboarding y pantallas
 * de notificaciones/preferencias.
 *
 *   node scripts/staging/e2e-s02b-acceso.mjs
 *
 * De donde sale cada celda (leido del codigo, no inventado):
 *   - proxy.ts -> lib/supabase/middleware.ts: sin sesion, /seller /admin
 *     /historial /perfil /favoritos /notificaciones /vender -> /login?next=<ruta>;
 *     con sesion, /login y /register -> destinoAutenticadoSeguro(next) ("/");
 *     con sesion y sin es_vendedor, /vender y /seller -> /empezar-a-vender.
 *   - app/(marketplace)/layout.tsx:128: con sesion y has_seen_onboarding=false,
 *     TODA ruta del grupo (marketplace) -> /bienvenida. Incluye legales.
 *   - Paginas: /configuracion(/notificaciones) -> /login?next=... sin sesion;
 *     (onboarding)/bienvenida y /completar-perfil -> "/" si ya termino y
 *     /login sin sesion; /activar-notificaciones sin guard de onboarding (a
 *     proposito); /empezar-a-vender -> "/" al vendedor asentado; admin/layout
 *     -> "/" a quien no es admin; seller/layout -> /empezar-a-vender.
 *
 * Celdas marcadas BUG: la app contradice su propio codigo/especificacion. No
 * se afirman como correctas: se comprueba lo que DEBERIA pasar y, si no pasa,
 * se listan aparte (no cuentan como paso; el script sigue saliendo 0 si todo
 * lo demas va bien, para servir de regresion). Si un dia pasan, salen como OK.
 *
 * OJO con la URL final: varias paginas tienen loading.tsx, y un redirect() de
 * la pagina llega DENTRO del stream (200 + NEXT_REDIRECT + meta refresh); el
 * cambio de URL es del cliente. rutaFinal() espera a que la URL se quede quieta.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, CONFIG_DIR } from './lib.mjs';
import { staging, crearUsuario, completarOnboarding, leer, limpiar } from './fixtures.mjs';
import { instalarMapkitFalso, LUGARES } from './mapkit-falso.mjs';

const require = createRequire(path.join(REPO_ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const OUT = path.join(CONFIG_DIR, 'e2e');
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };

const resultados = [];
const bugs = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};
/** Comprueba lo que la especificacion pide; si la app no lo cumple, es un BUG abierto. */
const bug = async (nombre, motivo, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre} (bug resuelto)${d ? ` — ${d}` : ''}`); }
  catch (e) { bugs.push(`${nombre}: ${e.message.split('\n')[0]}`); console.log(`  BUG  ${nombre} — ${e.message.split('\n')[0]} · ${motivo}`); }
};

/**
 * page.goto con reintento SOLO si el servidor no contesta: el dev server de
 * :3100 se reinicia solo al pasar un umbral de memoria (ERR_CONNECTION_*), y
 * eso no es un fallo de la app. Cualquier otro error sale tal cual.
 */
const SIN_SERVIDOR = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/;
const irA = async (page, url) => {
  let colgadas = 0;
  for (let i = 0; ; i++) {
    try { return await page.goto(url, { timeout: 120_000 }); }
    catch (e) {
      // Un goto que no termina en 2 min (servidor colgado) se repite hasta DOS veces.
      const colgado = /Timeout \d+ms exceeded/.test(e.message) && colgadas++ < 2;
      if (i >= 9 || !(SIN_SERVIDOR.test(e.message) || colgado)) throw e;
      await page.waitForTimeout(10_000);
    }
  }
};

const login = async (page, u) => {
  await irA(page, `${BASE}/login`);
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && new URL(page.url()).pathname.startsWith('/login'); i++) {
    await page.locator('#email').fill(u.email);
    await page.locator('#password').fill(u.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  }
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('no salio de /login');
};

/** pathname + ?next=<decodificado> (lo unico de la query que decide algo aqui). */
const normalizar = (href) => {
  const u = new URL(href);
  const next = u.searchParams.get('next');
  return next === null ? u.pathname : `${u.pathname}?next=${next}`;
};

/** Ruta final tras redirecciones de servidor Y de cliente (espera a que la URL se quede quieta). */
/** Un redirect() dentro del stream deja un <meta http-equiv="refresh"> hasta que el cliente navega. */
const redireccionPendiente = (page) =>
  page.evaluate(() => !!document.querySelector('meta[http-equiv="refresh"]')).catch(() => false);
const rutaFinal = async (page, ruta, intento = 0) => {
  try {
    await irA(page, `${BASE}${ruta}`);
  } catch (e) {
    // La propia cadena de redirecciones (meta refresh o router del cliente)
    // puede adelantarse al 'load' de goto: es parte del resultado, no un fallo.
    if (!/interrupted by another navigation/.test(e.message)) throw e;
  }
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
  let ultima = page.url();
  let quieta = Date.now();
  const tope = Date.now() + 45_000;
  while (Date.now() < tope && Date.now() - quieta < 2_500) {
    await page.waitForTimeout(200);
    if (page.url() !== ultima) { ultima = page.url(); quieta = Date.now(); }
    // Mientras quede el meta refresh del redirect en stream, la URL aun no es la final.
    if (Date.now() - quieta >= 2_500 && (await redireccionPendiente(page))) quieta = Date.now() - 1_500;
  }
  // El servidor se cayo a mitad (reinicio por memoria): se repite la celda.
  if (page.url().startsWith('chrome-error:') && intento < 3) {
    await page.waitForTimeout(15_000);
    return rutaFinal(page, ruta, intento + 1);
  }
  return normalizar(page.url());
};

const contexto = (browser, extra = {}) =>
  browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-MX', ...extra });

// ─── La matriz ───────────────────────────────────────────────────────────────
// Estados: V visitante · N con sesion SIN onboarding · O con onboarding · S vendedor.
// Cada celda es la ruta final esperada. { bug, motivo } = lo que pide la
// especificacion y la app no hace (ver cabecera).
const LEGAL = 'app/(onboarding)/empezar-a-vender/alta-vendedor.tsx:351 pide aceptar «Términos» y «Aviso de Privacidad» con enlaces target=_blank a /terminos y /privacidad DENTRO del onboarding, y (marketplace)/layout.tsx:128 los rebota a /bienvenida';
const BORRADO = '/eliminar-cuenta es la pagina publica de borrado (exenta en DEC-muro-entrada); a mitad de onboarding tampoco hay cerrar sesion ni /configuracion';
const MATRIZ = [
  ['/', { V: '/', N: '/bienvenida?next=/', O: '/', S: '/' }],
  ['/buscar', { V: '/login?next=/buscar', N: '/bienvenida?next=/buscar', O: '/buscar', S: '/buscar' }],
  ['/mapa', { V: '/login?next=/mapa', N: '/bienvenida?next=/mapa', O: '/mapa', S: '/mapa' }],
  ['/vender', { V: '/login?next=/vender', N: '/bienvenida?next=/vender', O: '/empezar-a-vender', S: '/vender' }],
  ['/perfil', { V: '/login?next=/perfil', N: '/bienvenida?next=/perfil', O: '/perfil', S: '/perfil' }],
  ['/favoritos', { V: '/login?next=/favoritos', N: '/bienvenida?next=/favoritos', O: '/favoritos', S: '/favoritos' }],
  ['/notificaciones', { V: '/login?next=/notificaciones', N: '/bienvenida?next=/notificaciones', O: '/notificaciones', S: '/notificaciones' }],
  ['/configuracion', { V: '/login?next=/configuracion', N: '/bienvenida?next=/configuracion', O: '/configuracion', S: '/configuracion' }],
  ['/configuracion/notificaciones', { V: '/login?next=/configuracion/notificaciones', N: '/bienvenida?next=/configuracion/notificaciones', O: '/configuracion/notificaciones', S: '/configuracion/notificaciones' }],
  ['/settings', { V: '/login?next=/settings', N: '/bienvenida?next=/settings', O: '/configuracion', S: '/configuracion' }],
  ['/historial', { V: '/login?next=/historial', N: '/bienvenida?next=/historial', O: '/historial', S: '/historial' }],
  ['/seller', { V: '/login?next=/seller', N: '/bienvenida?next=/seller', O: '/empezar-a-vender', S: '/seller' }],
  ['/admin', { V: '/login?next=/admin', N: '/bienvenida?next=/admin', O: '/', S: '/' }],
  ['/bienvenida', { V: '/login?next=/bienvenida', N: '/bienvenida', O: '/', S: '/' }],
  ['/completar-perfil', { V: '/login?next=/completar-perfil', N: '/completar-perfil', O: '/', S: '/' }],
  ['/activar-notificaciones', { V: '/login?next=/activar-notificaciones', N: '/activar-notificaciones', O: '/activar-notificaciones', S: '/activar-notificaciones' }],
  ['/empezar-a-vender', { V: '/login?next=/empezar-a-vender', N: '/empezar-a-vender', O: '/empezar-a-vender', S: '/' }],
  ['/login', { V: '/login', N: '/bienvenida?next=/', O: '/', S: '/' }],
  ['/login?next=/configuracion', { V: '/login?next=/configuracion', N: '/bienvenida?next=/configuracion', O: '/configuracion', S: '/configuracion' }],
  ['/register', { V: '/register', N: '/bienvenida?next=/', O: '/', S: '/' }],
  ['/forgot-password', { V: '/forgot-password', N: '/forgot-password', O: '/forgot-password', S: '/forgot-password' }],
  ['/terminos', { V: '/terminos', N: '/terminos', O: '/terminos', S: '/terminos' }],
  ['/privacidad', { V: '/privacidad', N: '/privacidad', O: '/privacidad', S: '/privacidad' }],
  ['/eliminar-cuenta', { V: '/eliminar-cuenta', N: '/eliminar-cuenta', O: '/eliminar-cuenta', S: '/eliminar-cuenta' }],
];
const ESTADOS = { V: 'visitante', N: 'sin onboarding', O: 'con onboarding', S: 'vendedor' };

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const N = await crearUsuario(cfg, 's02b-nuevo');
  const O = await crearUsuario(cfg, 's02b-listo');
  await completarOnboarding(cfg, O.id);
  const S = await crearUsuario(cfg, 's02b-vendedor');
  await completarOnboarding(cfg, S.id);
  await leer(cfg, `update public.profiles set es_vendedor = true, alta_vendedor_paso = null, nombre_negocio = 'Fixture S02B' where id = ${q(S.id)}`);
  const G = await crearUsuario(cfg, 's02b-gps');
  const usuarios = { N, O, S };

  const [pre] = await leer(cfg, `select
      (select has_seen_onboarding from public.profiles where id = ${q(N.id)}) as n_onb,
      (select es_vendedor from public.profiles where id = ${q(S.id)}) as s_vend,
      (select count(*)::int from public.user_roles where user_id in (${[N, O, S, G].map((u) => q(u.id)).join(', ')})) as roles`);
  if (pre.n_onb !== false || pre.s_vend !== true || pre.roles !== 0) throw new Error(`precondiciones: ${JSON.stringify(pre)}`);

  const browser = await chromium.launch({ headless: true });
  const errores = [];
  try {
    // ─── 1. Matriz estado x ruta ───────────────────────────────────────────
    // S02B_SIN_MATRIZ=1 salta la matriz (~30 min con el dev server) para iterar en el resto.
    for (const clave of process.env.S02B_SIN_MATRIZ ? [] : Object.keys(ESTADOS)) {
      const ctx = await contexto(browser);
      const inicio = await ctx.newPage();
      inicio.on('pageerror', (e) => errores.push(`${clave}: ${e.message}`));
      if (clave !== 'V') await paso(`login real (${ESTADOS[clave]})`, () => login(inicio, usuarios[clave]));
      await inicio.close();
      for (const [ruta, celdas] of MATRIZ) {
        const celda = celdas[clave];
        const nombre = `[${ESTADOS[clave]}] ${ruta}`;
        const comprobar = async () => {
          const esperado = typeof celda === 'string' ? celda : celda.bug;
          // Una pestana por celda (mismas cookies): una redireccion de cliente
          // rezagada de la celda anterior no puede interrumpir esta.
          const page = await ctx.newPage();
          page.on('pageerror', (e) => errores.push(`${clave} ${ruta}: ${e.message}`));
          try {
            const obtenido = await rutaFinal(page, ruta);
            exigir(obtenido === esperado, `fue a ${obtenido} (esperado ${esperado})`);
            return obtenido === ruta ? '' : `→ ${obtenido}`;
          } finally {
            await page.close();
          }
        };
        if (typeof celda === 'string') await paso(nombre, comprobar);
        else await bug(nombre, celda.motivo, comprobar);
      }
      await ctx.close();
    }

    await paso('El estado no cambio por recorrer la matriz (sigue sin onboarding; nadie gano rol ni modo vendedor)', async () => {
      const [r] = await leer(cfg, `select
          (select has_seen_onboarding from public.profiles where id = ${q(N.id)}) as n_onb,
          (select es_vendedor from public.profiles where id = ${q(N.id)}) as n_vend,
          (select es_vendedor from public.profiles where id = ${q(O.id)}) as o_vend,
          (select count(*)::int from public.user_roles where user_id in (${[N, O, S].map((u) => q(u.id)).join(', ')})) as roles`);
      exigir(r.n_onb === false && r.n_vend === false && r.o_vend === false && r.roles === 0, JSON.stringify(r));
      return JSON.stringify(r);
    });

    // ─── 2. /activar-notificaciones: destino de lista cerrada ────────────────
    {
      const ctx = await contexto(browser);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(`N-notif: ${e.message}`));
      await login(page, N);
      await paso('[sin onboarding] /activar-notificaciones?siguiente=//evil.example: «Continuar» va a /completar-perfil', async () => {
        await rutaFinal(page, '/activar-notificaciones?siguiente=%2F%2Fevil.example%2Fx');
        await page.getByRole('heading', { name: /Activa las\s*notificaciones/ }).waitFor({ timeout: 30_000 });
        const boton = page.getByRole('button', { name: 'Continuar' });
        const hasta = Date.now() + 20_000;
        while (Date.now() < hasta && new URL(page.url()).pathname === '/activar-notificaciones') {
          await boton.click().catch(() => {});
          await page.waitForURL((u) => u.pathname !== '/activar-notificaciones', { timeout: 3_000 }).catch(() => {});
        }
        const final = new URL(page.url());
        exigir(final.host === new URL(BASE).host && final.pathname === '/completar-perfil', `fue a ${final.href}`);
        return final.pathname;
      });
      await ctx.close();
    }

    // ─── 3. GPS denegado en el paso de ubicacion del onboarding ─────────────
    // Precondicion por SQL: G ya lleno perfil e intereses y va por «ubicacion».
    // Contexto sin cookie de zona, sin espejo local y SIN permiso de geolocalizacion.
    await leer(cfg, `update public.profiles set nombre = 'Fixture GPS', bio = 'Perfil sintetico', foto = 'https://example.invalid/fixture.png',
        intereses = array['comida'], onboarding_camino = 'explorar', onboarding_paso = 'ubicacion' where id = ${q(G.id)}`);
    {
      const ctx = await contexto(browser);
      const lugares = [...LUGARES, { consulta: 'puebla', displayLines: ['Puebla', 'Puebla, México'], lat: PUEBLA.lat, lng: PUEBLA.lng, countryCode: 'MX' }];
      const cuentas = await instalarMapkitFalso(ctx, { lugares });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(`G: ${e.message}`));
      await paso('login real (onboarding a medias, paso «ubicacion»)', () => login(page, G));

      const entrar = page.getByRole('button', { name: 'Entrar a VICINO' });
      await paso('/bienvenida reanuda en /completar-perfil, paso «¿Dónde estás?», con «Entrar» apagado sin zona', async () => {
        const r = await rutaFinal(page, '/bienvenida');
        exigir(r === '/completar-perfil', `fue a ${r}`);
        await page.getByRole('heading', { name: '¿Dónde estás?' }).waitFor({ timeout: 30_000 });
        exigir(await entrar.isDisabled(), '«Entrar a VICINO» habilitado sin ubicacion');
        exigir(!(await ctx.cookies()).some((c) => c.name === 'vicino_location'), 'ya habia cookie de zona');
      });

      await paso('GPS denegado: «Usar mi ubicación actual» avisa «Permiso denegado» y no desbloquea', async () => {
        await page.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
        await page.getByText('Permiso denegado').waitFor({ timeout: 20_000 });
        exigir(await entrar.isDisabled(), 'se habilito sin ubicacion');
        await page.screenshot({ path: path.join(OUT, 's02b-gps-denegado.png') });
      });

      const buscador = page.getByPlaceholder('Busca tu colonia, municipio o código postal…');
      await paso('Salida manual sin resultados: ofrece «Usar el punto del mapa…»', async () => {
        await buscador.pressSequentially('xqzvw', { delay: 30 });
        await page.getByText('No encontramos lugares con ese nombre.').waitFor({ timeout: 20_000 });
        await page.getByRole('button', { name: 'Usar el punto del mapa sin asociarlo al texto buscado' }).waitFor({ timeout: 5_000 });
        await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
      });

      await paso('Salida manual con el buscador: elegir «Puebla» habilita «Entrar a VICINO»', async () => {
        await buscador.pressSequentially('puebla', { delay: 30 });
        const sugerencia = page.getByRole('button', { name: /Puebla/ }).first();
        await sugerencia.waitFor({ timeout: 20_000 });
        await sugerencia.click();
        const hasta = Date.now() + 15_000;
        while (Date.now() < hasta && (await entrar.isDisabled())) await page.waitForTimeout(300);
        exigir(!(await entrar.isDisabled()), 'sigue apagado tras elegir la zona');
        const c = cuentas();
        exigir(c.script > 0, `MapKit falso sin usar: ${JSON.stringify(c)}`);
      });

      await paso('«Entrar a VICINO» termina el onboarding: home, cookie de zona escrita y /bienvenida ya no aplica', async () => {
        await entrar.click();
        await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
        const [p] = await leer(cfg, `select has_seen_onboarding from public.profiles where id = ${q(G.id)}`);
        exigir(p.has_seen_onboarding === true, 'has_seen_onboarding sigue en false');
        const cookie = (await ctx.cookies()).find((c) => c.name === 'vicino_location');
        const [lat, lng] = decodeURIComponent(cookie?.value ?? '').split(',').map(Number);
        exigir(Math.abs(lat - PUEBLA.lat) < 0.01 && Math.abs(lng - PUEBLA.lng) < 0.01, `cookie vicino_location=${cookie?.value}`);
        const r = await rutaFinal(page, '/bienvenida');
        exigir(r === '/', `/bienvenida fue a ${r}`);
        return `cookie ${decodeURIComponent(cookie.value)}`;
      });
      await ctx.close();
    }

    // ─── 4. Notificaciones y preferencias (usuario con onboarding) ──────────
    {
      const ctx = await contexto(browser);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(`O-pref: ${e.message}`));
      await login(page, O);

      await paso('/configuracion enlaza a Notificaciones y la pantalla de preferencias carga (aviso de navegador)', async () => {
        await rutaFinal(page, '/configuracion');
        // Por href: la campana del header tambien se llama «Notificaciones» (va a /notificaciones).
        const enlace = page.locator('a[href="/configuracion/notificaciones"]');
        await enlace.waitFor({ timeout: 30_000 });
        const hasta = Date.now() + 20_000;
        while (Date.now() < hasta && new URL(page.url()).pathname !== '/configuracion/notificaciones') {
          await enlace.click().catch(() => {});
          await page.waitForURL((u) => u.pathname === '/configuracion/notificaciones', { timeout: 4_000 }).catch(() => {});
        }
        exigir(new URL(page.url()).pathname === '/configuracion/notificaciones', `quedo en ${page.url()}`);
        await page.locator('[data-preferencias-listas="true"]').waitFor({ timeout: 30_000 });
        const n = await page.getByRole('switch').count();
        exigir(n === 4, `${n} interruptores`);
        await page.getByText('Aquí puedes elegir, pero el aviso llega en la app').waitFor({ timeout: 10_000 });
        return `${n} interruptores`;
      });

      const leerPref = async () => {
        const [r] = await leer(cfg, `select notification_preferences->'comunidades' as v from public.profiles where id = ${q(O.id)}`);
        return r.v;
      };
      const sw = page.getByRole('switch', { name: /Comunidades/ });
      await paso('Apagar «Comunidades» se guarda en la base y sobrevive a recargar', async () => {
        exigir((await sw.getAttribute('aria-checked')) === 'true', 'no arranco encendido');
        await sw.click();
        const hasta = Date.now() + 20_000;
        while (Date.now() < hasta && (await leerPref()) !== false) await page.waitForTimeout(500);
        exigir((await leerPref()) === false, `en la base: ${await leerPref()}`);
        await irA(page, page.url());
        await page.locator('[data-preferencias-listas="true"]').waitFor({ timeout: 30_000 });
        exigir((await sw.getAttribute('aria-checked')) === 'false', 'tras recargar vuelve a encendido');
        const otros = await page.getByRole('switch', { checked: true }).count();
        exigir(otros === 3, `${otros} encendidos (se toco otra clave)`);
      });
      await paso('Volver a encenderlo tambien se guarda', async () => {
        await sw.click();
        const hasta = Date.now() + 20_000;
        while (Date.now() < hasta && (await leerPref()) !== true) await page.waitForTimeout(500);
        exigir((await leerPref()) === true, `en la base: ${await leerPref()}`);
      });

      await paso('/notificaciones (la campana) carga para el usuario con onboarding', async () => {
        const r = await rutaFinal(page, '/notificaciones');
        exigir(r === '/notificaciones', `fue a ${r}`);
        await page.getByRole('heading', { name: 'Notificaciones', exact: true }).waitFor({ timeout: 30_000 });
      });

      await paso('[con onboarding] /activar-notificaciones no tiene guard (a proposito) y «Continuar» acaba en el home', async () => {
        await rutaFinal(page, '/activar-notificaciones');
        const boton = page.getByRole('button', { name: 'Continuar' });
        await boton.waitFor({ timeout: 30_000 });
        const hasta = Date.now() + 20_000;
        while (Date.now() < hasta && new URL(page.url()).pathname === '/activar-notificaciones') {
          await boton.click().catch(() => {});
          await page.waitForTimeout(1_500);
        }
        const r = await rutaFinal(page, new URL(page.url()).pathname);
        exigir(r === '/', `fue a ${r}`);
        return r;
      });
      await ctx.close();
    }

    await paso('sin errores de pagina', async () => { if (errores.length) throw new Error(errores.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    if (bugs.length) console.log(`\nBugs de la app (no cuentan como paso):\n${bugs.map((b) => `  - ${b}`).join('\n')}`);
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Bugs de la app abiertos: ${bugs.length}. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length && n === 0 ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
