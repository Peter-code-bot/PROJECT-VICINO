#!/usr/bin/env node
/**
 * Crea (o reutiliza) el proyecto Supabase de STAGING y guarda sus datos en
 * `.staging/staging.json`. Idempotente: si el proyecto ya existe y esta sano,
 * solo refresca las claves.
 *
 *   node scripts/staging/crear.mjs
 *
 * Tiene costo mientras exista (compute por hora). Borrarlo al terminar:
 *   node scripts/staging/borrar.mjs
 */
import {
  api, readConfig, writeConfig, randomPassword, assertNoProd, sleep,
  ORG_ID, STAGING_NAME,
} from './lib.mjs';

const REGION = 'us-west-2'; // la misma que produccion

const findExisting = async () => {
  const projects = await api('GET', '/projects');
  return projects.find((p) => p.name === STAGING_NAME && p.organization_id === ORG_ID) ?? null;
};

const waitHealthy = async (ref) => {
  for (let i = 0; i < 90; i++) {
    const p = await api('GET', `/projects/${ref}`);
    if (p.status === 'ACTIVE_HEALTHY') return p;
    if (i % 6 === 0) console.log(`  estado: ${p.status}...`);
    await sleep(10_000);
  }
  throw new Error('El proyecto no quedo ACTIVE_HEALTHY en 15 minutos.');
};

const main = async () => {
  let cfg = readConfig();
  let project = await findExisting();

  if (!project) {
    const dbPass = randomPassword();
    console.log(`Creando ${STAGING_NAME} en ${REGION} (micro)...`);
    project = await api('POST', '/projects', {
      name: STAGING_NAME,
      organization_id: ORG_ID,
      region: REGION,
      db_pass: dbPass,
      desired_instance_size: 'micro',
    });
    cfg = { ref: project.id ?? project.ref, dbPass };
    writeConfig(cfg);
  } else if (!cfg || cfg.ref !== (project.id ?? project.ref)) {
    throw new Error(
      `Ya existe ${STAGING_NAME} pero .staging/staging.json no es de ese proyecto. ` +
        'Borralo desde el panel o restaura el archivo; no se adivina la contrasena.'
    );
  }

  const ref = cfg.ref;
  assertNoProd(ref);
  await waitHealthy(ref);

  const keys = await api('GET', `/projects/${ref}/api-keys?reveal=true`);
  const legacy = (name) => keys.find((k) => k.type === 'legacy' && k.name === name)?.api_key;
  cfg = { ...cfg, url: `https://${ref}.supabase.co`, anon: legacy('anon'), service: legacy('service_role') };
  if (!cfg.anon || !cfg.service) throw new Error('No se obtuvieron las claves anon/service_role del staging.');
  writeConfig(cfg);

  console.log(`OK staging listo: ref=${ref} url=${cfg.url} (claves guardadas en .staging/staging.json)`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
