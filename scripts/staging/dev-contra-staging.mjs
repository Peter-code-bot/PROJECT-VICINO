#!/usr/bin/env node
/**
 * Levanta la web local (next dev, webpack como en el build) apuntando al
 * STAGING en http://localhost:3100. Las claves salen de .staging/staging.json
 * y viajan por el entorno del proceso hijo: nunca por la linea de comandos.
 *
 *   node scripts/staging/dev-contra-staging.mjs
 *
 * Las variables de proceso ganan a .env.local en Next, asi que la app local
 * no puede caer en produccion. Sentry, Resend e IA quedan apagados: una prueba
 * contra staging no debe ensuciar la telemetria ni mandar correos reales.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readConfig, REPO_ROOT } from './lib.mjs';

const cfg = readConfig();
if (!cfg?.url || !cfg.anon || !cfg.service) {
  console.error('Staging sin claves. Corre scripts/staging/crear.mjs');
  process.exit(1);
}
const PORT = process.env.PORT_STAGING || '3100';
const web = path.join(REPO_ROOT, 'apps', 'web');
const nextBin = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next');

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: cfg.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: cfg.anon,
  SUPABASE_SERVICE_ROLE_KEY: cfg.service,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_DSN_MOBILE: '',
  SENTRY_DSN: '',
  RESEND_API_KEY: '',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  VICINO_ENTORNO: 'staging',
};

console.log(`web local -> staging ${cfg.ref} en http://localhost:${PORT}`);
const child = spawn(process.execPath, [nextBin, 'dev', '--webpack', '-p', PORT], { cwd: web, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
