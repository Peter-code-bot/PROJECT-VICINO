#!/usr/bin/env node
/**
 * Comprueba que las versiones legales del codigo y las de la base dicen lo mismo.
 *
 *   node scripts/check-legal-versions.mjs
 *
 * POR QUE EXISTE, Y POR QUE ES CULPA DE UN CAMBIO PROPIO. Al crear la tabla
 * legal_documents aparecio una segunda fuente de verdad: hasta entonces la
 * version vivia solo en packages/shared/src/constants/privacy.ts, y ahora vive
 * tambien en la base. Dos copias del mismo dato que nada obliga a coincidir es
 * exactamente el problema que esa constante vino a resolver en su dia — la
 * version estaba escrita a mano dentro del JSX de cada pagina.
 *
 * La divergencia aqui no es cosmetica. La PAGINA muestra la constante y el
 * REGISTRO guarda la fila de la base: si se separan, a la persona se le ensena
 * la version 2.3 y queda registrada aceptando la 2.2. Un registro que dice algo
 * distinto de lo que se mostro no acredita nada, que era justo el punto de
 * llevar registro.
 *
 * No puede evitarse con una restriccion de la base —el codigo esta fuera de su
 * alcance—, asi que se convierte en un fallo RUIDOSO: falla en CI en vez de
 * pudrirse en silencio.
 *
 * Sale 0 si coinciden, 1 si no, y 2 si no pudo comprobarlo (sin credencial).
 * El 2 es distinto a proposito: "no se pudo mirar" no es "esta bien".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONSTANTES = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'constants', 'privacy.ts');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

/** documento en la base -> constante en el codigo. */
const PAREJAS = [
  { documento: 'aviso', constante: 'AVISO_PRIVACIDAD_VERSION' },
  { documento: 'terminos', constante: 'TERMINOS_VERSION' },
];

const leerConstante = (fuente, nombre) => {
  // Se ancla al `export const NOMBRE = "x.y" as const` literal. Si alguien
  // cambia la forma de declararlo, esto NO adivina: falla y lo dice.
  const m = new RegExp(`export const ${nombre}\\s*=\\s*["']([^"']+)["']`).exec(fuente);
  if (!m) {
    throw new Error(
      `No se encontro ${nombre} en ${path.relative(REPO_ROOT, CONSTANTES)}.\n` +
        'Si se renombro o cambio de forma, actualiza este script: preferimos que ' +
        'falle a que deje de comprobar sin avisar.'
    );
  }
  return m[1];
};

const readToken = () => {
  const fromEnv = process.env.VICINO_SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv.trim();

  const envFile = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    if (line) return line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  }
  return null;
};

const main = async () => {
  const token = readToken();
  if (!token) {
    process.stderr.write(
      'No hay credencial para consultar produccion: NO SE PUDO COMPROBAR.\n' +
        'Esto no equivale a "esta bien".\n'
    );
    process.exit(2);
  }

  const fuente = fs.readFileSync(CONSTANTES, 'utf8');

  // La version VIGENTE de cada documento: la de mayor vigente_desde que ya
  // entro en vigor. Una publicada y aun no vigente esta corriendo su preaviso
  // de 30 dias y no debe coincidir todavia con lo que muestra la pagina.
  const consulta = `
    SELECT DISTINCT ON (documento) documento, version
    FROM public.legal_documents
    WHERE vigente_desde <= now()
    ORDER BY documento, vigente_desde DESC, publicado_en DESC`;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `BEGIN READ ONLY;${consulta};ROLLBACK;` }),
  });
  if (!response.ok) {
    process.stderr.write(`No se pudo consultar produccion: HTTP ${response.status}\n`);
    process.exit(2);
  }

  const filas = await response.json();
  const enBase = new Map((filas ?? []).map((f) => [f.documento, f.version]));

  let desfase = 0;
  for (const { documento, constante } of PAREJAS) {
    const enCodigo = leerConstante(fuente, constante);
    const vigente = enBase.get(documento);

    if (!vigente) {
      console.log(`FALLA  ${documento}: el codigo dice ${enCodigo} y la base no tiene NINGUNA version vigente`);
      desfase++;
    } else if (vigente !== enCodigo) {
      console.log(`FALLA  ${documento}: codigo ${enCodigo}  !=  base ${vigente}`);
      desfase++;
    } else {
      console.log(`OK     ${documento}: ${enCodigo}`);
    }
  }

  if (desfase > 0) {
    process.stderr.write(
      `\n${desfase} documento(s) desfasado(s).\n` +
        'Al publicar una version nueva hay que hacer LAS DOS cosas: subir la\n' +
        'constante en packages/shared/src/constants/privacy.ts Y anadir la fila en\n' +
        'legal_documents mediante una migracion. Si el cambio es SUSTANCIAL, la\n' +
        'fila lleva vigente_desde a 30 dias vista: la base rechaza menos.\n'
    );
    process.exit(1);
  }

  console.log('\nCodigo y base coinciden.');
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
