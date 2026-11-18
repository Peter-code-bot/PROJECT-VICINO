#!/usr/bin/env node
/**
 * product-media sin listado anonimo (20261118230000) contra el STAGING, por la
 * API de Storage de verdad: la misma que usa la app.
 *
 *   node scripts/staging/probar-product-media-sin-listado.mjs
 *
 * Crea un vendedor y otra cuenta, sube una imagen con la sesion del vendedor a
 * su carpeta y comprueba:
 *   - ANTES de la migracion (si falta en el ledger): el comportamiento que
 *     corrige, para que la prueba demuestre algo;
 *   - aplica la migracion y ensaya su reversion dentro de una transaccion que
 *     se deshace;
 *   - DESPUES: anon no lista ni la raiz ni la carpeta; otra cuenta tampoco; la
 *     URL publica sigue sirviendo la imagen; el dueno lista lo suyo, sube
 *     (INSERT ... RETURNING) y borra (DELETE ... RETURNING); otra cuenta no
 *     puede subirle ni borrarle nada.
 * Retira los fixtures al final. Sale con 1 si algun caso no cumple.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { staging, crearUsuario, limpiar } from './fixtures.mjs';
import { sql, REPO_ROOT } from './lib.mjs';

const cfg = staging();
const MIGRACION = '20261118230000_product_media_sin_listado_anonimo.sql';
const REVERSION = 'docs/rollback/20261118230000_product_media_sin_listado_anonimo_rollback.sql';
const BUCKET = 'product-media';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// PNG de 1x1: el bucket solo acepta imagenes y video.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

const cabeceras = (token) => ({ apikey: cfg.anon, Authorization: `Bearer ${token ?? cfg.anon}` });

/** Nombres que devuelve el listado, o el estado si no es una lista. */
const listar = async (prefix, token) => {
  const res = await fetch(`${cfg.url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...cabeceras(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  const cuerpo = await res.json().catch(() => null);
  return { status: res.status, nombres: Array.isArray(cuerpo) ? cuerpo.map((f) => f.name) : null };
};
const subir = (ruta, token) => fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${ruta}`, {
  method: 'POST',
  headers: { ...cabeceras(token), 'Content-Type': 'image/png', 'cache-control': 'max-age=60' },
  body: PNG,
});
const borrar = async (ruta, token) => {
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...cabeceras(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [ruta] }),
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
};
const existe = async (ruta) => {
  const [fila] = await sql(cfg.ref, `select count(*)::int as n from storage.objects where bucket_id = ${q(BUCKET)} and name = ${q(ruta)}`);
  return fila.n === 1;
};
const enLedger = async () => {
  const [fila] = await sql(cfg.ref, `select count(*)::int as n from supabase_migrations.schema_migrations where version = ${q(MIGRACION.slice(0, 14))}`);
  return fila.n === 1;
};

const main = async () => {
  console.log(`staging ${cfg.ref}`);
  const dueno = await crearUsuario(cfg, 'media-dueno');
  const otra = await crearUsuario(cfg, 'media-otra');
  const ruta = `${dueno.id}/prueba-listado-${crypto.randomBytes(3).toString('hex')}.png`;
  const archivo = ruta.slice(dueno.id.length + 1);
  const yaAplicada = await enLedger();

  try {
    await caso('el dueno sube una imagen a su carpeta con su sesion', async () => {
      const res = await subir(ruta, dueno.token);
      esperar(res.status === 200, `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      esperar(await existe(ruta), 'no quedo la fila en storage.objects');
    });

    if (yaAplicada) {
      console.log('  (la migracion ya estaba en el ledger: no se puede mirar el ANTES)');
    } else {
      await caso('ANTES: la clave anon lista la carpeta del vendedor y su archivo', async () => {
        const raiz = await listar('', null);
        const carpeta = await listar(`${dueno.id}/`, null);
        esperar(raiz.nombres?.includes(dueno.id), `la raiz no trae la carpeta: ${JSON.stringify(raiz)}`);
        esperar(carpeta.nombres?.includes(archivo), `la carpeta no trae el archivo: ${JSON.stringify(carpeta)}`);
        return `raiz con ${raiz.nombres.length} carpeta(s), carpeta con ${carpeta.nombres.length} archivo(s)`;
      });
    }

    await caso(`migracion ${MIGRACION.slice(0, 14)} presente en staging`, async () => {
      if (yaAplicada) return 'ya estaba aplicada';
      const texto = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', MIGRACION), 'utf8');
      await sql(cfg.ref, `begin;\n${texto}\ninsert into supabase_migrations.schema_migrations(version, name) values (${q(MIGRACION.slice(0, 14))}, ${q(MIGRACION.slice(15, -4))}) on conflict do nothing;\ncommit;`);
      return 'aplicada en esta corrida, con su verify';
    });

    await caso('la reversion corre completa (dentro de una transaccion que se deshace)', async () => {
      const texto = fs.readFileSync(path.join(REPO_ROOT, REVERSION), 'utf8')
        .replace(/^begin;$/im, '').replace(/^commit;$/im, '');
      await sql(cfg.ref, `begin;\n${texto}\nrollback;`);
      const [p] = await sql(cfg.ref, `select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read for product media'`);
      esperar(p.n === 0, 'la lectura publica volvio: la reversion no se deshizo');
    });

    await caso('DESPUES: anon no ve la carpeta en la raiz', async () => {
      const raiz = await listar('', null);
      esperar(raiz.nombres !== null, `HTTP ${raiz.status}`);
      esperar(!raiz.nombres.includes(dueno.id), 'la raiz sigue trayendo la carpeta del vendedor');
      return `HTTP ${raiz.status}, ${raiz.nombres.length} entradas`;
    });

    await caso('DESPUES: anon no lista la carpeta del vendedor', async () => {
      const carpeta = await listar(`${dueno.id}/`, null);
      esperar(!carpeta.nombres?.length, `trae ${JSON.stringify(carpeta.nombres)}`);
      return `HTTP ${carpeta.status}, 0 archivos`;
    });

    // No se prueba /object/authenticated: en un bucket publico Storage lo
    // sirve sin mirar RLS, igual que la URL publica (comprobado en la primera
    // corrida, 18-nov). Hace falta la ruta exacta del archivo.

    await caso('DESPUES: otra cuenta no lista la carpeta del vendedor', async () => {
      const carpeta = await listar(`${dueno.id}/`, otra.token);
      esperar(!carpeta.nombres?.length, `trae ${JSON.stringify(carpeta.nombres)}`);
    });

    await caso('DESPUES: la URL publica sigue sirviendo la imagen', async () => {
      const res = await fetch(`${cfg.url}/storage/v1/object/public/${BUCKET}/${ruta}`);
      esperar(res.status === 200, `HTTP ${res.status}`);
      esperar(res.headers.get('content-type') === 'image/png', `content-type ${res.headers.get('content-type')}`);
      esperar(Buffer.from(await res.arrayBuffer()).equals(PNG), 'los bytes no coinciden');
      return 'HTTP 200 image/png, mismos bytes';
    });

    await caso('DESPUES: el dueno lista lo suyo', async () => {
      const carpeta = await listar(`${dueno.id}/`, dueno.token);
      esperar(carpeta.nombres?.includes(archivo), `no lo ve: ${JSON.stringify(carpeta)}`);
    });

    await caso('DESPUES: el dueno sigue subiendo a su carpeta (INSERT ... RETURNING)', async () => {
      const segunda = `${dueno.id}/prueba-subida-${crypto.randomBytes(3).toString('hex')}.png`;
      const res = await subir(segunda, dueno.token);
      esperar(res.status === 200, `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const quitada = await borrar(segunda, dueno.token);
      esperar(quitada.status === 200 && !(await existe(segunda)), `no la pudo quitar: ${JSON.stringify(quitada)}`);
    });

    await caso('DESPUES: nadie sube a la carpeta de otro', async () => {
      const res = await subir(`${dueno.id}/intruso.png`, otra.token);
      esperar(res.status !== 200, 'otra cuenta subio a la carpeta del vendedor');
      return `HTTP ${res.status}`;
    });

    await caso('DESPUES: otra cuenta no le borra nada al vendedor', async () => {
      await borrar(ruta, otra.token);
      esperar(await existe(ruta), 'la otra cuenta borro el archivo');
    });

    await caso('DESPUES: el dueno borra su archivo (DELETE ... RETURNING)', async () => {
      const res = await borrar(ruta, dueno.token);
      esperar(res.status === 200, `HTTP ${res.status} ${JSON.stringify(res.cuerpo)}`);
      esperar(!(await existe(ruta)), 'el archivo sigue ahi');
    });
  } finally {
    // Lo que haya quedado de los fixtures, con la clave de servicio.
    const restos = await sql(cfg.ref, `select name from storage.objects where bucket_id = ${q(BUCKET)} and (name like ${q(`${dueno.id}/%`)} or name like ${q(`${otra.id}/%`)})`);
    if (restos.length) {
      await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: restos.map((r) => r.name) }),
      });
    }
    const quedan = await limpiar(cfg);
    console.log(`fixtures retirados (quedan: ${JSON.stringify(quedan)})`);
  }

  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallos}/${resultados.length} casos en verde`);
  if (fallos) process.exit(1);
};

await main();
