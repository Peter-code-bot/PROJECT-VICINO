#!/usr/bin/env node
/**
 * Borra el proyecto de STAGING y su `.staging/staging.json`. Sin argumentos no
 * hace nada: exige `--si` para que un tab-completion no tire el entorno.
 *
 *   node scripts/staging/borrar.mjs --si
 */
import fs from 'node:fs';
import { api, readConfig, assertNoProd, CONFIG_FILE, STAGING_NAME } from './lib.mjs';

const main = async () => {
  const cfg = readConfig();
  if (!cfg) return console.log('No hay staging registrado.');
  assertNoProd(cfg.ref);
  const p = await api('GET', `/projects/${cfg.ref}`);
  if (p.name !== STAGING_NAME) throw new Error(`El ref ${cfg.ref} no es ${STAGING_NAME} (${p.name}); no se borra.`);
  if (!process.argv.includes('--si')) return console.log(`Se borraria ${p.name} (${cfg.ref}). Repite con --si.`);
  await api('DELETE', `/projects/${cfg.ref}`);
  fs.rmSync(CONFIG_FILE);
  console.log(`Borrado ${p.name} (${cfg.ref}).`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
