#!/usr/bin/env node
/**
 * Regenera apps/web/types/database.types.ts desde el schema de produccion.
 *
 *   node scripts/gen-types.mjs            escribe el archivo
 *   node scripts/gen-types.mjs --check    falla si el del repo esta desfasado
 *
 * Por que existe: el archivo de tipos llevaba meses sin regenerarse y no lo
 * importaba nadie, asi que era 100 KB que mentian en silencio. Le faltaba
 * sort_order, entre otras. Un tipo generado que nadie regenera es peor que no
 * tenerlo: da la impresion de que el compilador vigila el schema cuando no.
 *
 * El token se pasa al CLI por el entorno del proceso hijo, nunca por argumentos:
 * en PowerShell los argumentos quedan en el historial de PSReadLine.
 *
 * --check es para CI. Es la contraparte del problema de fondo de toda esta
 * jornada: una desviacion que nadie observa. Si el schema cambia y nadie
 * regenera, el build lo dice.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const DESTINO = path.join(REPO_ROOT, 'apps', 'web', 'types', 'database.types.ts');

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

  throw new Error(
    'No hay token. Define VICINO_SUPABASE_PAT (scripts/setup-agent-secrets.ps1) ' +
      'o deja SUPABASE_ACCESS_TOKEN en .env'
  );
};

const generar = () =>
  new Promise((resolve, reject) => {
    const hijo = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', 'supabase@latest', 'gen', 'types', 'typescript',
       '--project-id', PROJECT_REF, '--schema', 'public,graphql_public'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: readToken() },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Node en Windows se niega a lanzar un .cmd sin shell desde la
        // correccion de CVE-2024-27980. Aqui es inofensivo: todos los
        // argumentos son literales fijos, no entra nada del exterior, y el
        // token va por el entorno del hijo y no por la linea de comandos.
        shell: process.platform === 'win32',
      }
    );

    let salida = '';
    let error = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { error += d; });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        // El CLI puede incluir el token en un mensaje de error de auth.
        // Se corta a la primera linea y se recorta cualquier cosa larga.
        const primera = (error.split(/\r?\n/)[0] || 'sin detalle').slice(0, 200);
        reject(new Error(`supabase gen types salio con ${codigo}: ${primera}`));
        return;
      }
      if (!salida.includes('export type Database')) {
        reject(new Error('La salida no parece un archivo de tipos valido.'));
        return;
      }
      resolve(salida);
    });
  });

const main = async () => {
  const check = process.argv.includes('--check');
  const generado = await generar();

  // El CLI emite LF; el repo tiene .gitattributes pero este archivo no es .sql.
  // Se normaliza para que la comparacion de --check no dependa del sistema.
  const normalizar = (s) => s.replace(/\r\n/g, '\n').trimEnd() + '\n';
  const nuevo = normalizar(generado);

  const actual = fs.existsSync(DESTINO)
    ? normalizar(fs.readFileSync(DESTINO, 'utf8'))
    : null;

  if (check) {
    if (actual === nuevo) {
      console.log('Los tipos del repo coinciden con produccion.');
      return;
    }
    console.error(
      'Los tipos del repo NO coinciden con el schema de produccion.\n' +
        'Corre: node scripts/gen-types.mjs'
    );
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(DESTINO, nuevo, 'utf8');
  console.log(
    actual === nuevo
      ? 'Sin cambios: ya estaban al dia.'
      : `Escrito ${path.relative(REPO_ROOT, DESTINO)} (${nuevo.length} caracteres).`
  );
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
