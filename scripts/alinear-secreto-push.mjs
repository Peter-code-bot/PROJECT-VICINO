#!/usr/bin/env node
/**
 * Alinea el secreto que send-push espera con el que los triggers ya mandan.
 *
 *   node scripts/alinear-secreto-push.mjs            # solo mira y reporta
 *   node scripts/alinear-secreto-push.mjs --escribir # ademas lo iguala
 *
 * POR QUE EXISTE
 *
 * send-push estaba desplegada sin ninguna comprobacion de quien la llama, con
 * verify_jwt apagado en la pasarela. Un POST anonimo ejecutaba el cuerpo entero
 * y consultaba la base con la service_role. El arreglo pone una puerta dentro
 * de la funcion, pero una puerta mal alineada es peor que ninguna: si el bearer
 * que mandan los triggers no coincide con lo que la funcion espera, las
 * notificaciones push dejan de llegar Y NADIE SE ENTERA, porque las funciones
 * call_send_push_* capturan con EXCEPTION WHEN OTHERS y solo emiten un WARNING.
 *
 * Los triggers mandan, desde la migracion 20260826090000:
 *   'Authorization', 'Bearer ' || vault.decrypted_secrets.service_role_key
 *
 * Y la funcion, tras el arreglo, acepta PUSH_WEBHOOK_SECRET o SB_SECRET_KEY.
 * Igualando PUSH_WEBHOOK_SECRET al valor del vault, la puerta encaja por
 * construccion y no hay que adivinar si las dos llaves de servicio del proyecto
 * (la legacy en formato JWT y la nueva sb_secret_) son la misma.
 *
 * EL VALOR NUNCA SE IMPRIME NI PASA POR LA LINEA DE COMANDOS. Se lee del vault
 * por la Management API y se escribe por la Management API, dentro de este
 * proceso. Lo unico que sale por pantalla es la forma: formato, longitud y los
 * primeros doce caracteres de su sha256, que sirven para comparar sin revelar.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oxxdkwywprkfghhbnoto';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const NOMBRE_EN_VAULT = 'service_role_key';
const NOMBRE_EN_FUNCION = 'PUSH_WEBHOOK_SECRET';

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
  throw new Error('Falta SUPABASE_ACCESS_TOKEN (en el entorno o en .env)');
};

const TOKEN = leerToken();

const consultar = async (sql) => {
  const r = await fetch(`${API}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Management API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

/** Describe un secreto sin revelarlo. */
const forma = (valor) => {
  const huella = crypto.createHash('sha256').update(valor).digest('hex').slice(0, 12);
  const formato = valor.startsWith('sb_secret_')
    ? 'nueva (sb_secret_)'
    : valor.startsWith('eyJ')
      ? 'legacy (JWT)'
      : 'desconocido';
  return { formato, longitud: valor.length, huella };
};

const main = async () => {
  const escribir = process.argv.includes('--escribir');

  // 1. El valor que los triggers mandan hoy.
  const filas = await consultar(
    `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${NOMBRE_EN_VAULT}' LIMIT 1;`,
  );
  const delVault = filas?.[0]?.decrypted_secret;
  if (!delVault) {
    console.error(
      `No hay ningun secreto llamado '${NOMBRE_EN_VAULT}' en el vault.\n` +
        'Sin el, las funciones call_send_push_* ya estan saliendo por su RAISE WARNING\n' +
        'y NO se esta mandando ninguna push. Eso es un problema aparte y mas urgente.',
    );
    process.exit(2);
  }

  const f = forma(delVault);
  console.log('Secreto que los triggers mandan hoy (vault.' + NOMBRE_EN_VAULT + '):');
  console.log(`  formato : ${f.formato}`);
  console.log(`  longitud: ${f.longitud}`);
  console.log(`  sha256  : ${f.huella}...`);
  console.log();

  // 2. Que secretos ve la funcion. La API devuelve los nombres, no los valores.
  const r = await fetch(`${API}/secrets`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`No pude listar los secretos: ${r.status}`);
  const secretos = await r.json();
  const nombres = secretos.map((s) => s.name);
  console.log('Secretos visibles para las Edge Functions:');
  for (const n of nombres.sort()) {
    console.log(`  ${n === NOMBRE_EN_FUNCION ? '*' : ' '} ${n}`);
  }
  console.log();

  const yaEsta = nombres.includes(NOMBRE_EN_FUNCION);
  if (yaEsta && !escribir) {
    console.log(
      `${NOMBRE_EN_FUNCION} ya existe. Este script no puede leer su valor (la API\n` +
        'solo devuelve nombres), asi que no puede afirmar que coincida con el del\n' +
        'vault. Corre con --escribir para igualarlo sin lugar a dudas.',
    );
    return;
  }

  if (!escribir) {
    console.log(
      `${NOMBRE_EN_FUNCION} NO esta configurado.\n\n` +
        'Sin el, send-push cae en su segunda opcion, SB_SECRET_KEY, que puede o no\n' +
        'ser el mismo valor que el del vault. Si no lo es, tras desplegar el arreglo\n' +
        'los triggers empezarian a recibir 401 y las push dejarian de llegar EN\n' +
        'SILENCIO, porque call_send_push_* captura con EXCEPTION WHEN OTHERS.\n\n' +
        'Para igualarlo (el valor no pasa por la linea de comandos ni se imprime):\n' +
        '  node scripts/alinear-secreto-push.mjs --escribir',
    );
    return;
  }

  const w = await fetch(`${API}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: NOMBRE_EN_FUNCION, value: delVault }]),
  });
  if (!w.ok) throw new Error(`No pude escribir el secreto: ${w.status} ${(await w.text()).slice(0, 200)}`);

  console.log(`${NOMBRE_EN_FUNCION} igualado al valor del vault (sha256 ${f.huella}...).`);
  console.log();
  console.log('Ahora ya se puede desplegar sin riesgo de cortar las push:');
  console.log('  npx supabase functions deploy send-push --project-ref ' + PROJECT_REF);
  console.log();
  console.log('Y despues, comprobar que la puerta quedo puesta:');
  console.log('  node scripts/verificar-send-push.mjs');
};

main().catch((e) => {
  process.stderr.write(e.message + '\n');
  process.exit(1);
});
