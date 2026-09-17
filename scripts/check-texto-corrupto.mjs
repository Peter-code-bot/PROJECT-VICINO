#!/usr/bin/env node
/**
 * Busca texto corrupto (el caracter de reemplazo Unicode, U+FFFD) en las
 * columnas que la gente LEE en pantalla.
 *
 *   node scripts/check-texto-corrupto.mjs
 *
 * POR QUE EXISTE. El 16-sep-2026 el nombre de Javier aparecia en /admin/users
 * como "Javier Rodr<?>guez": el rombo con el signo de interrogacion. El dato
 * estaba asi GUARDADO desde una escritura que no viajo en UTF-8, y nadie se
 * entero hasta que salio en una captura de pantalla. La aplicacion de hoy no
 * puede producirlo —escribe siempre en UTF-8 y normaliza a NFC—, pero un
 * script de seed, una importacion o un cliente nuevo si podrian, y el fallo no
 * levanta ninguna alarma: Postgres acepta U+FFFD como cualquier otro
 * caracter.
 *
 * Esto es la alarma. Sale 0 si no hay nada, 1 si encuentra filas, con el
 * recuento por columna para que se vea donde entro.
 *
 * El token sale de VICINO_SUPABASE_PAT, SUPABASE_ACCESS_TOKEN o del .env.
 * Nunca se imprime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/**
 * Columnas vigiladas: texto que alguien ve. No se vigila todo el esquema a
 * proposito — una consulta por columna cuesta, y lo que importa es lo que se
 * lee. Al anadir una tabla con texto visible, anadela aqui.
 */
const COLUMNAS = [
  ['profiles', 'nombre'],
  ['profiles', 'bio'],
  ['profiles', 'nombre_negocio'],
  ['profiles', 'ubicacion'],
  ['products_services', 'titulo'],
  ['products_services', 'descripcion'],
  ['products_services', 'ubicacion'],
  ['communities', 'nombre'],
  ['communities', 'descripcion'],
  ['community_posts', 'cuerpo'],
  ['reviews', 'comentario'],
];

function leerToken() {
  const deEntorno = process.env.VICINO_SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
  if (deEntorno) return deEntorno.trim();
  const envFile = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const linea = fs
      .readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    if (linea) return linea.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error(
    'Falta el token: define VICINO_SUPABASE_PAT o SUPABASE_ACCESS_TOKEN (o SUPABASE_ACCESS_TOKEN= en .env).',
  );
}

async function consultar(token, sql) {
  const respuesta = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!respuesta.ok) {
    // El cuerpo del error de la Management API no lleva el token, pero si
    // lleva el SQL: se recorta para no volcar una consulta larga al log.
    const detalle = (await respuesta.text()).slice(0, 300);
    throw new Error(`La consulta fallo (${respuesta.status}): ${detalle}`);
  }
  return respuesta.json();
}

const token = leerToken();

// Una sola consulta con UNION ALL: once viajes de red para contar once
// columnas seria pagar diez veces de mas.
const sql = COLUMNAS.map(
  ([tabla, columna]) =>
    `select '${tabla}.${columna}' as donde, count(*)::int as filas from public.${tabla} where ${columna} like '%' || U&'\\FFFD' || '%'`,
).join('\nunion all\n');

const resultado = await consultar(token, sql);
const filas = Array.isArray(resultado) ? resultado : (resultado.result ?? []);
const conProblema = filas.filter((f) => Number(f.filas) > 0);

if (conProblema.length === 0) {
  process.stdout.write('OK: ninguna columna vigilada tiene texto corrupto (U+FFFD).\n');
  process.exit(0);
}

process.stderr.write('TEXTO CORRUPTO EN LA BASE (caracter de reemplazo U+FFFD):\n');
for (const fila of conProblema) {
  process.stderr.write(`  ${fila.donde}: ${fila.filas} fila(s)\n`);
}
process.stderr.write(
  '\nQue hacer: mirar por donde entro (un script de seed, una importacion, un cliente\n' +
    'que no manda UTF-8) y reparar el dato como en\n' +
    'supabase/migrations/20260916150000_texto_corrupto_en_nombres_de_perfil.sql.\n',
);
process.exit(1);
