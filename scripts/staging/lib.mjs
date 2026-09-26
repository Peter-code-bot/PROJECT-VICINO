/**
 * Utilidades del entorno de STAGING de VICINO (PT00/PT02/PT03).
 *
 * Todo lo de esta carpeta escribe de verdad, asi que la regla que importa es
 * una: NUNCA contra produccion. `assertNoProd` se llama antes de cada peticion
 * que lleva un ref; no es opcional ni configurable.
 *
 * El estado del staging (ref, url, claves de ESE proyecto y su contrasena de
 * base) vive en `.staging/staging.json`, fuera de git. Nada de aqui imprime
 * esos valores.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROD_REF = 'oxxdkwywprkfghhbnoto';
export const ORG_ID = 'djjcnwqrqzpgndyktfcq';
export const STAGING_NAME = 'vicino-staging';
export const CONFIG_DIR = path.join(REPO_ROOT, '.staging');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'staging.json');
const API = 'https://api.supabase.com/v1';

export const assertNoProd = (ref) => {
  if (!ref || typeof ref !== 'string') throw new Error('Falta el ref del staging.');
  if (ref === PROD_REF) throw new Error('Esto escribe de verdad: se niega a tocar produccion.');
};

export const readToken = () => {
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
  throw new Error('No hay token de la Management API (VICINO_SUPABASE_PAT o SUPABASE_ACCESS_TOKEN en .env).');
};

export const readConfig = () => {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  assertNoProd(cfg.ref);
  return cfg;
};

export const writeConfig = (cfg) => {
  assertNoProd(cfg.ref);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
};

export const randomPassword = () => crypto.randomBytes(24).toString('base64url');

/** Peticion a la Management API. Devuelve el JSON o lanza con el cuerpo del error. */
export const api = async (method, route, body) => {
  // La Management API limita por minuto (429). Se espera y se reintenta con
  // retroceso; cualquier otro error sale tal cual, con su cuerpo.
  for (let intento = 0; ; intento++) {
    const res = await fetch(`${API}${route}`, {
      method,
      headers: { Authorization: `Bearer ${readToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 429 && intento < 8) {
      await sleep(Math.min(60_000, 2_000 * 2 ** intento));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${route}: ${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : null;
  }
};

/** SQL contra el staging (como postgres). Lanza con el SQLSTATE si falla. */
export const sql = async (ref, query) => {
  assertNoProd(ref);
  return api('POST', `/projects/${ref}/database/query`, { query });
};

/** SQL de SOLO LECTURA contra produccion, para comparar esquemas. */
export const prodRead = async (query) => {
  const guarded = `BEGIN READ ONLY;\n${query.trim().replace(/;\s*$/, '')};\nROLLBACK;`;
  return api('POST', `/projects/${PROD_REF}/database/query`, { query: guarded });
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
