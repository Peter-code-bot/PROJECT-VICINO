#!/usr/bin/env node
/**
 * Redes del negocio (20261108230000) contra el STAGING: PostgREST, RLS,
 * privilegios por columna y SECURITY DEFINER reales.
 *
 *   node scripts/staging/probar-redes-negocio.mjs
 *
 * Aplica 20261108120000 y 20261108230000 si faltan en el ledger del staging,
 * ensaya la reversion dentro de una transaccion que se deshace, crea un
 * vendedor, una cuenta que no vende y otra visitante, y comprueba:
 *   - que cualquiera (tambien sin sesion) lee las columnas nuevas y nadie las
 *     escribe directo;
 *   - guardar_enlaces_negocio: normaliza nada (eso es del cliente) pero valida
 *     cada red, no toca las claves que no vienen, quita con null, rechaza claves
 *     desconocidas sin repetirlas, ata Messenger al usuario de Facebook, exige
 *     modo vendedor para poner y deja quitar siempre;
 *   - que el RPC viejo sigue funcionando y no toca las columnas nuevas;
 *   - los clics de los canales nuevos y el conteo agrupado por canal.
 * Retira los fixtures al final. Sale con 1 si algun caso no cumple.
 */
import fs from 'node:fs';
import path from 'node:path';
import { staging, http, rpc, crearUsuario, limpiar } from './fixtures.mjs';
import { sql, REPO_ROOT } from './lib.mjs';

const cfg = staging();
const MIGRACIONES = [
  '20261108120000_enlaces_de_contacto_del_negocio.sql',
  '20261108230000_mas_redes_del_negocio.sql',
];
const REVERSION = 'docs/rollback/20261108230000_mas_redes_del_negocio_rollback.sql';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resultados = [];
const caso = async (nombre, fn) => {
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true });
    console.log(`  OK    ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  } catch (e) {
    resultados.push({ nombre, ok: false });
    console.log(`  FALLO ${nombre} — ${e.message}`);
  }
};
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };
const corto = (r) => `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`;

const asegurarMigracion = async (archivo) => {
  const version = archivo.slice(0, 14);
  const [fila] = await sql(cfg.ref, `select count(*)::int as n from supabase_migrations.schema_migrations where version = ${q(version)}`);
  if (fila.n === 1) return 'ya estaba aplicada';
  const texto = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', archivo), 'utf8');
  await sql(cfg.ref, `begin;\n${texto}\ninsert into supabase_migrations.schema_migrations(version, name) values (${q(version)}, ${q(archivo.slice(15, -4))}) on conflict do nothing;\ncommit;`);
  return 'aplicada en esta corrida';
};

/** Vendedor por el camino que exige la base (ver probar-mapa-v3.mjs). */
const habilitarVendedor = async (userId) => {
  const vigente = (doc) => `(select version from public.legal_documents where documento = '${doc}' and vigente_desde <= now() order by vigente_desde desc, publicado_en desc limit 1)`;
  await sql(
    cfg.ref,
    `begin;
     select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
     select public.confirmar_documentos_cuenta(${vigente('terminos')}, ${vigente('aviso')}, true, true);
     update public.profiles set es_vendedor = true, seller_visibility_confirmed_at = now(), seller_visibility_version = 'vendedor-v1'
       where id = ${q(userId)};
     commit;`
  );
};

const COLUMNAS = 'instagram_usuario, whatsapp_numero, facebook_ruta, facebook_messenger, tiktok_usuario, youtube_ruta, x_usuario, linkedin_ruta, threads_usuario, pinterest_usuario, telegram_usuario';
const fila = async (id) => (await sql(cfg.ref, `select ${COLUMNAS} from public.profiles where id = ${q(id)}`))[0];
const guardar = (token, enlaces) => rpc(cfg, token, 'guardar_enlaces_negocio', { p_enlaces: enlaces });

const main = async () => {
  console.log(`staging ${cfg.ref}`);
  for (const m of MIGRACIONES) await caso(`migracion ${m.slice(0, 14)} presente en staging`, () => asegurarMigracion(m));

  await caso('la reversion corre completa (dentro de una transaccion que se deshace)', async () => {
    const texto = fs.readFileSync(path.join(REPO_ROOT, REVERSION), 'utf8')
      .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await sql(cfg.ref, `begin;\n${texto}\nrollback;`);
    const [col] = await sql(cfg.ref, `select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'tiktok_usuario'`);
    esperar(col.n === 1, 'la columna desaparecio: la reversion no se deshizo');
    return 'sin errores; el esquema sigue igual';
  });

  const ana = await crearUsuario(cfg, 'redes-ana');
  const beto = await crearUsuario(cfg, 'redes-beto');
  const visita = await crearUsuario(cfg, 'redes-visita');
  await habilitarVendedor(ana.id);

  try {
    await caso('invitado y otra cuenta leen las columnas nuevas por PostgREST', async () => {
      for (const token of [undefined, visita.token]) {
        const r = await http(cfg, 'GET', `/rest/v1/profiles?select=facebook_ruta,facebook_messenger,tiktok_usuario,youtube_ruta,x_usuario,linkedin_ruta,threads_usuario,pinterest_usuario,telegram_usuario&id=eq.${ana.id}`, { token });
        esperar(r.status === 200, corto(r));
      }
    });

    await caso('nadie escribe las columnas nuevas directo (ni el dueno)', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/profiles?id=eq.${ana.id}`, { token: ana.token, body: { tiktok_usuario: 'directo' } });
      esperar(r.status === 401 || r.status === 403, corto(r));
      const f = await fila(ana.id);
      esperar(f.tiktok_usuario === null, `quedo ${f.tiktok_usuario}`);
      return `HTTP ${r.status}`;
    });

    await caso('el vendedor guarda varias redes y el resto queda como estaba', async () => {
      const r1 = await guardar(ana.token, { instagram_usuario: 'mi.tienda', whatsapp_numero: '522221234567' });
      esperar(r1.status === 200, corto(r1));
      const r2 = await guardar(ana.token, {
        facebook_ruta: 'mitienda.puebla', facebook_messenger: true, tiktok_usuario: 'Mi.Tienda',
        youtube_ruta: '@panaderíalaesquina', x_usuario: 'MiTienda', linkedin_ruta: 'company/mi-tienda',
        threads_usuario: 'mi.tienda', pinterest_usuario: 'MiTienda', telegram_usuario: 'mitienda_pue',
      });
      esperar(r2.status === 200, corto(r2));
      const f = await fila(ana.id);
      esperar(f.instagram_usuario === 'mi.tienda' && f.whatsapp_numero === '522221234567', `instagram/whatsapp cambiaron: ${JSON.stringify(f)}`);
      esperar(f.facebook_messenger === true && f.tiktok_usuario === 'Mi.Tienda' && f.youtube_ruta === '@panaderíalaesquina', JSON.stringify(f));
      esperar(f.linkedin_ruta === 'company/mi-tienda' && f.telegram_usuario === 'mitienda_pue', JSON.stringify(f));
      return 'claves que no vienen, intactas; handle con acento aceptado';
    });

    await caso('null quita solo ese enlace', async () => {
      const r = await guardar(ana.token, { pinterest_usuario: null, x_usuario: '' });
      esperar(r.status === 200, corto(r));
      const f = await fila(ana.id);
      esperar(f.pinterest_usuario === null && f.x_usuario === null && f.tiktok_usuario === 'Mi.Tienda', JSON.stringify(f));
    });

    await caso('cada red rechaza su formato malo con 400 y no guarda nada', async () => {
      const malos = [
        { facebook_ruta: 'abc' }, { facebook_ruta: 'profile.php?id=12' }, { tiktok_usuario: 'mitienda.' },
        { youtube_ruta: '@mi/canal' }, { youtube_ruta: 'micanal' }, { x_usuario: 'a'.repeat(16) },
        { linkedin_ruta: 'mi-tienda' }, { linkedin_ruta: 'school/x' }, { threads_usuario: 'Mi.Tienda' },
        { pinterest_usuario: '12345' }, { telegram_usuario: 'MiTienda' },
      ];
      for (const malo of malos) {
        const r = await guardar(ana.token, { ...malo, instagram_usuario: 'otra.cuenta' });
        esperar(r.status === 400, `${JSON.stringify(malo)}: ${corto(r)}`);
      }
      const f = await fila(ana.id);
      esperar(f.instagram_usuario === 'mi.tienda', 'una llamada rechazada guardo la mitad');
      return `${malos.length} rechazados`;
    });

    await caso('clave desconocida o de otro tipo: 400 sin repetir lo que mando el cliente', async () => {
      const r1 = await guardar(ana.token, { snapchat_usuario: 'mitienda' });
      esperar(r1.status === 400 && !JSON.stringify(r1.body).includes('snapchat'), corto(r1));
      const r2 = await guardar(ana.token, { tiktok_usuario: 123 });
      esperar(r2.status === 400, corto(r2));
      const r3 = await rpc(cfg, ana.token, 'guardar_enlaces_negocio', { p_enlaces: ['tiktok_usuario'] });
      esperar(r3.status === 400, corto(r3));
    });

    await caso('Messenger cuelga del usuario de Facebook', async () => {
      const conId = await guardar(ana.token, { facebook_ruta: 'profile.php?id=61550000000000', facebook_messenger: true });
      esperar(conId.status === 400, `Messenger con ID numerico: ${corto(conId)}`);
      const quitar = await guardar(ana.token, { facebook_ruta: null });
      esperar(quitar.status === 200, corto(quitar));
      const f = await fila(ana.id);
      esperar(f.facebook_ruta === null && f.facebook_messenger === false, `quitar Facebook dejo Messenger: ${JSON.stringify(f)}`);
      const otraVez = await guardar(ana.token, { facebook_ruta: 'mitienda.puebla', facebook_messenger: true });
      esperar(otraVez.status === 200, corto(otraVez));
      return 'con ID: 400; sin Facebook: se apaga solo';
    });

    await caso('el CHECK frena aunque alguien salte el RPC (como postgres)', async () => {
      let fallo = null;
      try { await sql(cfg.ref, `update public.profiles set x_usuario = 'mi tienda' where id = ${q(ana.id)}`); } catch (e) { fallo = e.message; }
      esperar(fallo && /profiles_x_usuario_formato|23514|check/i.test(fallo), `el UPDATE paso: ${fallo}`);
      fallo = null;
      try { await sql(cfg.ref, `update public.profiles set facebook_ruta = null where id = ${q(ana.id)}`); } catch (e) { fallo = e.message; }
      esperar(fallo && /profiles_facebook_messenger_con_usuario|23514|check/i.test(fallo), `Messenger sin Facebook paso: ${fallo}`);
    });

    await caso('sin modo vendedor: poner se rechaza y quitar se permite', async () => {
      const poner = await guardar(beto.token, { tiktok_usuario: 'beto' });
      esperar(poner.status === 403 || poner.status === 401, corto(poner));
      const quitar = await guardar(beto.token, { tiktok_usuario: null, facebook_messenger: false });
      esperar(quitar.status === 200, corto(quitar));
      return `poner HTTP ${poner.status}, quitar HTTP ${quitar.status}`;
    });

    await caso('sin sesion no se ejecuta guardar_enlaces_negocio', async () => {
      const r = await guardar(undefined, { tiktok_usuario: null });
      esperar(r.status === 401 || r.status === 403 || r.status === 404, corto(r));
      return `HTTP ${r.status}`;
    });

    await caso('el RPC viejo sigue funcionando y no toca las redes nuevas', async () => {
      const r = await rpc(cfg, ana.token, 'actualizar_enlaces_negocio', { p_instagram_usuario: 'mi.tienda', p_whatsapp_numero: '522221234567' });
      esperar(r.status === 200, corto(r));
      const f = await fila(ana.id);
      esperar(f.tiktok_usuario === 'Mi.Tienda' && f.facebook_messenger === true, JSON.stringify(f));
    });

    await caso('clics: cuentan los canales nuevos configurados, no los que faltan ni los del dueno', async () => {
      const tiktok = await rpc(cfg, undefined, 'registrar_clic_enlace_negocio', { p_vendedor_id: ana.id, p_canal: 'tiktok' });
      esperar(tiktok.status === 200 && tiktok.body === true, `tiktok: ${corto(tiktok)}`);
      const messenger = await rpc(cfg, visita.token, 'registrar_clic_enlace_negocio', { p_vendedor_id: ana.id, p_canal: 'messenger' });
      esperar(messenger.status === 200 && messenger.body === true, `messenger: ${corto(messenger)}`);
      const pinterest = await rpc(cfg, undefined, 'registrar_clic_enlace_negocio', { p_vendedor_id: ana.id, p_canal: 'pinterest' });
      esperar(pinterest.status === 200 && pinterest.body === false, `pinterest sin configurar: ${corto(pinterest)}`);
      const dueno = await rpc(cfg, ana.token, 'registrar_clic_enlace_negocio', { p_vendedor_id: ana.id, p_canal: 'tiktok' });
      esperar(dueno.status === 200 && dueno.body === false, `dueno: ${corto(dueno)}`);
      const raro = await rpc(cfg, undefined, 'registrar_clic_enlace_negocio', { p_vendedor_id: ana.id, p_canal: 'snapchat' });
      esperar(raro.status === 400, `snapchat: ${corto(raro)}`);
    });

    await caso('conteo agrupado: el dueno ve los suyos, otra cuenta nada, sin sesion no entra', async () => {
      const propio = await rpc(cfg, ana.token, 'clics_enlaces_negocio_por_canal', { p_dias: 30 });
      esperar(propio.status === 200, corto(propio));
      const porCanal = Object.fromEntries((propio.body ?? []).map((r) => [r.canal, Number(r.clics)]));
      esperar(porCanal.tiktok === 1 && porCanal.messenger === 1 && !porCanal.pinterest, JSON.stringify(porCanal));
      const ajeno = await rpc(cfg, visita.token, 'clics_enlaces_negocio_por_canal', { p_dias: 30 });
      esperar(ajeno.status === 200 && Array.isArray(ajeno.body) && ajeno.body.length === 0, corto(ajeno));
      const anon = await rpc(cfg, undefined, 'clics_enlaces_negocio_por_canal', { p_dias: 30 });
      esperar(anon.status === 401 || anon.status === 403 || anon.status === 404, corto(anon));
      return JSON.stringify(porCanal);
    });

    await caso('apagar todo (lo que manda el formulario sin modo vendedor) deja las trece en vacio', async () => {
      const todo = Object.fromEntries([
        'instagram_usuario', 'whatsapp_numero', 'google_maps_url', 'google_resenas_url', 'facebook_ruta', 'tiktok_usuario',
        'youtube_ruta', 'x_usuario', 'linkedin_ruta', 'threads_usuario', 'pinterest_usuario', 'telegram_usuario',
      ].map((c) => [c, null]));
      const r = await guardar(ana.token, { ...todo, facebook_messenger: false });
      esperar(r.status === 200, corto(r));
      const f = await fila(ana.id);
      esperar(Object.entries(f).every(([k, v]) => (k === 'facebook_messenger' ? v === false : v === null)), JSON.stringify(f));
    });
  } finally {
    await limpiar(cfg);
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallos}/${resultados.length} casos en verde`);
  process.exit(fallos ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e);
  try { await limpiar(cfg); } catch { /* ya se reporto el error principal */ }
  process.exit(1);
});
