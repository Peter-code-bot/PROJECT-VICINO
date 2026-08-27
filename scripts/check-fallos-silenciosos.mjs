#!/usr/bin/env node
/**
 * Lee lo unico que sabe de verdad si las llamadas salientes funcionan.
 *
 *   node scripts/check-fallos-silenciosos.mjs
 *
 * POR QUE EXISTE
 *
 * pg_cron marca un trabajo como 'succeeded' en cuanto ENCOLA el POST. No mira
 * la respuesta. Asi que un endpoint que devuelva 401, 500 o que agote el tiempo
 * de espera aparece como exito en cron.job_run_details, y no hay ninguna
 * alerta. Este proyecto ya pago esa lección: los avisos de citas y los push
 * llevaban tiempo sin llegar y el panel decia que todo iba bien.
 *
 * La unica evidencia real vive en net._http_response, y se autoborra a las 6
 * horas. Nadie la lee. Este script la lee.
 *
 * LIMITE HONESTO, DICHO AQUI PARA QUE NADIE SE CONFIE
 *
 * net.http_request_queue se vacia cuando la peticion se completa, asi que la
 * URL de destino ya no esta cuando llega la respuesta. En la practica el
 * CUERPO suele delatar el endpoint -- comprobado: se distinguen
 * send-appointment-reminders por sus reminders_1d/reminders_1h y
 * purge-verification-documents por sus *_purged -- y por eso el script lo
 * imprime recortado. Pero eso es una pista, no una identificacion: una funcion
 * que devuelva 401 antes de escribir nada en el cuerpo saldria aqui sin
 * nombre.
 *
 * La identificacion de verdad exige guardar el id que devuelve net.http_post
 * junto al nombre del trabajo en el momento de encolar, y eso son cinco
 * funciones tocadas. Queda anotado, no hecho.
 *
 * Y la ventana de 6 horas manda: si esto corre cada 3 horas nunca pierde nada;
 * si corre una vez al dia, ve como mucho las ultimas 6.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const leerToken = () => {
  const delEntorno = process.env.VICINO_SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
  if (delEntorno) return delEntorno.trim();
  const archivo = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(archivo)) {
    const linea = fs
      .readFileSync(archivo, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    if (linea) return linea.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  }
  return null;
};

const consultar = async (token, sql) => {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Management API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const main = async () => {
  const token = leerToken();
  if (!token) {
    // Salir en verde sin haber mirado es el fallo silencioso que este script
    // viene a cazar. Se sale con 2, que no es exito.
    console.error(
      'No hay SUPABASE_ACCESS_TOKEN, asi que este script NO COMPROBO NADA.\n' +
        'Sale con 2 a proposito: un check que aprueba sin mirar es peor que no tenerlo.',
    );
    process.exit(2);
  }

  // Nunca se selecciona la columna `headers`: lleva el Authorization Bearer de
  // la peticion original.
  const fallos = await consultar(
    token,
    `SELECT id, status_code, timed_out, error_msg,
            left(coalesce(content, ''), 160) AS cuerpo,
            created
       FROM net._http_response
      WHERE status_code IS NULL
         OR status_code NOT BETWEEN 200 AND 299
         OR timed_out
         OR error_msg IS NOT NULL
      ORDER BY created DESC
      LIMIT 50;`,
  );

  const total = await consultar(
    token,
    `SELECT count(*) AS n, min(created) AS desde, max(created) AS hasta
       FROM net._http_response;`,
  );

  const n = total?.[0]?.n ?? 0;
  console.log(`Respuestas salientes en la ventana de retencion: ${n}`);
  if (total?.[0]?.desde) {
    console.log(`  desde ${total[0].desde}`);
    console.log(`  hasta ${total[0].hasta}`);
  }

  if (n === 0) {
    // No es un fallo, pero tampoco es una aprobacion: significa que en las
    // ultimas 6 horas no salio ni una peticion. Si eso pasa a media manana con
    // los cron activos, algo esta mal antes del POST.
    console.log('\nNo hay ninguna respuesta registrada. Eso NO prueba que todo vaya bien:');
    console.log('prueba que no salio ninguna peticion. Con los cron activos, revisa');
    console.log('cron.job_run_details y que el secreto del vault siga estando.');
    return;
  }

  if (fallos.length === 0) {
    console.log(`\nLas ${n} respuestas son 2xx, sin timeouts y sin error_msg.`);
    return;
  }

  console.error(`\n${fallos.length} respuesta(s) NO fueron un exito:\n`);
  for (const f of fallos) {
    console.error(
      `  id=${f.id}  status=${f.status_code ?? 'null'}  timeout=${f.timed_out}  ${f.created}`,
    );
    if (f.error_msg) console.error(`     error: ${f.error_msg}`);
    if (f.cuerpo) console.error(`     cuerpo: ${String(f.cuerpo).replace(/\s+/g, ' ')}`);
  }
  console.error(
    '\nRecuerda que pg_cron habra marcado estos trabajos como succeeded: solo mira\n' +
      'si consiguio encolar el POST, no lo que contesto el otro lado.',
  );
  process.exit(1);
};

main().catch((e) => {
  process.stderr.write(e.message + '\n');
  process.exit(1);
});
