#!/usr/bin/env node
/**
 * BUG-VERIF-IA (27-sep-2026): prueba de la migracion 20260927110000 contra el
 * STAGING, por la API real (PostgREST + Storage) y con JWT de verdad, no con
 * `postgres`, que se salta RLS y los GRANT por columna.
 *
 *   node scripts/staging/probar-verificacion-ia.mjs
 *
 * Comprueba:
 *   - que el vendedor ya no puede BORRAR la nota de la IA (la primera version
 *     la ponia en NULL con un simple PATCH de submitted_at): ahora se conserva
 *     y queda marcada ai_vigente = false;
 *   - que ni el vendedor ni un admin pueden volver a marcarla vigente ni tocar
 *     ai_analizado_en;
 *   - que la escritura de la IA (service_role) no se marca como desfasada;
 *   - que nadie aprueba ni rechaza su propia solicitud, ni por RPC ni por
 *     INSERT/UPDATE directo, y que el error trae el codigo VC403;
 *   - que otro revisor si puede;
 *   - que reemplazar una foto en Storage (upsert en la misma ruta) mueve su
 *     updated_at, que es en lo que se apoya el panel para detectar una foto
 *     cambiada sin tocar la fila.
 *
 * Fixtures sinteticos (@staging.vicino.test); se retiran al final.
 */
import { sql } from './lib.mjs';
import { staging, crearUsuario, http, rpc, limpiar } from './fixtures.mjs';

const cfg = staging();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const BUCKET = 'verification-documents';
const resultados = [];
const paso = async (nombre, fn) => {
  try { const d = await fn(); resultados.push(true); console.log(`  OK   ${nombre}${d ? ` — ${d}` : ''}`); }
  catch (e) { resultados.push(false); console.log(`  FALLO ${nombre} — ${e.message.split('\n')[0]}`); }
};
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };
const codigo = (r) => (r.body && typeof r.body === 'object' ? r.body.code : null);

/** Fila leida como postgres: la evidencia que el cliente no puede falsear. */
const fila = async (id) => (await sql(cfg.ref,
  `select status, ai_analysis_raw, ai_vigente, ai_analizado_en, university_name from public.seller_verification where id = ${q(id)}`))[0];

const conServicio = (method, route, body) => http(cfg, method, route, { token: cfg.service, body, prefer: 'return=representation' });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const subir = (token, ruta) => fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${ruta}`, {
  method: 'POST',
  headers: { apikey: cfg.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
  body: PNG,
});
const listar = async (token, carpeta) => {
  const res = await fetch(`${cfg.url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: cfg.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: carpeta, limit: 100 }),
  });
  if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
  return res.json();
};

const main = async () => {
  const vendedor = await crearUsuario(cfg, 'verif-vendedor');
  const adminA = await crearUsuario(cfg, 'verif-admin-a');
  const adminB = await crearUsuario(cfg, 'verif-admin-b');
  await sql(cfg.ref, `insert into public.user_roles (user_id, role) values (${q(adminA.id)}, 'admin'), (${q(adminB.id)}, 'admin') on conflict do nothing`);
  const docs = (u) => ({ selfie_url: `${u.id}/selfie`, ine_front_url: `${u.id}/ine_front`, ine_back_url: `${u.id}/ine_back` });

  let idVendedor = null;
  let idAdminA = null;
  try {
    await paso('el vendedor crea su solicitud pendiente', async () => {
      const r = await http(cfg, 'POST', '/rest/v1/seller_verification', {
        token: vendedor.token, prefer: 'return=representation',
        body: { user_id: vendedor.id, status: 'pending', document_type: 'Credencial Universitaria', university_name: 'UMAD', submitted_at: new Date().toISOString(), ...docs(vendedor) },
      });
      esperar(r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
      idVendedor = r.body[0].id;
    });

    await paso('la IA (service_role) escribe un veredicto negativo y queda vigente', async () => {
      const r = await conServicio('PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        ai_analysis_raw: { motivo_rechazo_o_duda: 'NEGATIVO: la credencial no es de la UMAD' },
        ai_confidence_score: 12, ai_vigente: true, ai_analizado_en: new Date().toISOString(),
        university_name: 'UMAD',
      });
      esperar(r.status === 200 && r.body.length === 1, `${r.status} ${JSON.stringify(r.body)}`);
      const f = await fila(idVendedor);
      esperar(f.ai_vigente === true && f.ai_analysis_raw, JSON.stringify(f));
    });

    await paso('PATCH de solo submitted_at: la nota NEGATIVA sigue ahi, marcada como desfasada', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: vendedor.token, prefer: 'return=representation', body: { submitted_at: new Date().toISOString() },
      });
      esperar(r.status === 200 && r.body.length === 1, `${r.status} ${JSON.stringify(r.body)}`);
      const f = await fila(idVendedor);
      esperar(f.ai_analysis_raw?.motivo_rechazo_o_duda?.startsWith('NEGATIVO'), `la nota se borro: ${JSON.stringify(f.ai_analysis_raw)}`);
      esperar(f.ai_vigente === false, `ai_vigente=${f.ai_vigente}`);
      return 'ai_vigente=false, nota conservada';
    });

    await paso('el vendedor NO puede volver a marcarla vigente', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: vendedor.token, body: { ai_vigente: true },
      });
      esperar(codigo(r) === '42501', `${r.status} ${JSON.stringify(r.body)}`);
      esperar((await fila(idVendedor)).ai_vigente === false, 'cambio igual');
    });

    await paso('el vendedor NO puede mover ai_analizado_en ni borrar la nota', async () => {
      const a = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: vendedor.token, body: { ai_analizado_en: '2099-01-01T00:00:00Z' },
      });
      const b = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: vendedor.token, body: { ai_analysis_raw: null },
      });
      esperar(codigo(a) === '42501' && codigo(b) === '42501', `${JSON.stringify(a.body)} | ${JSON.stringify(b.body)}`);
    });

    await paso('un admin tampoco puede marcar vigente una nota ajena', async () => {
      const r = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: adminB.token, body: { ai_vigente: true },
      });
      esperar(codigo(r) === '42501', `${r.status} ${JSON.stringify(r.body)}`);
    });

    await paso('cambiar la universidad tambien marca desfasado; la IA al re-analizar la deja vigente', async () => {
      await conServicio('PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, { ai_vigente: true });
      const r = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        token: vendedor.token, prefer: 'return=representation', body: { university_name: 'Anahuac', status: 'pending' },
      });
      esperar(r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
      esperar((await fila(idVendedor)).ai_vigente === false, 'no se marco');
      const ia = await conServicio('PATCH', `/rest/v1/seller_verification?id=eq.${idVendedor}`, {
        ai_analysis_raw: { motivo_rechazo_o_duda: 'OK Anahuac' }, ai_vigente: true,
        ai_analizado_en: new Date().toISOString(), university_name: 'Anahuac', document_type: 'Credencial Universitaria',
      });
      esperar(ia.status === 200, JSON.stringify(ia.body));
      const f = await fila(idVendedor);
      esperar(f.ai_vigente === true && f.ai_analysis_raw.motivo_rechazo_o_duda === 'OK Anahuac', JSON.stringify(f));
    });

    await paso('select * del vendedor sobre su fila sigue funcionando (GRANT de SELECT)', async () => {
      const r = await http(cfg, 'GET', `/rest/v1/seller_verification?select=*&id=eq.${idVendedor}`, { token: vendedor.token });
      esperar(r.status === 200 && r.body.length === 1 && 'ai_vigente' in r.body[0], `${r.status} ${JSON.stringify(r.body)}`);
    });

    await paso('un admin NO puede insertarse su propia fila ya aprobada (VC403)', async () => {
      const r = await http(cfg, 'POST', '/rest/v1/seller_verification', {
        token: adminA.token, body: { user_id: adminA.id, status: 'approved', document_type: 'INE', submitted_at: new Date().toISOString(), ...docs(adminA) },
      });
      esperar(codigo(r) === 'VC403', `${r.status} ${JSON.stringify(r.body)}`);
      const [n] = await sql(cfg.ref, `select count(*)::int n from public.seller_verification where user_id = ${q(adminA.id)}`);
      esperar(n.n === 0, 'la fila se creo');
    });

    await paso('el admin crea su solicitud pendiente (eso si)', async () => {
      const r = await http(cfg, 'POST', '/rest/v1/seller_verification', {
        token: adminA.token, prefer: 'return=representation',
        body: { user_id: adminA.id, status: 'pending', document_type: 'INE', submitted_at: new Date().toISOString(), ...docs(adminA) },
      });
      esperar(r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
      idAdminA = r.body[0].id;
    });

    await paso('ni PATCH directo ni RPC: el admin no se aprueba ni se rechaza a si mismo', async () => {
      const directo = await http(cfg, 'PATCH', `/rest/v1/seller_verification?id=eq.${idAdminA}`, { token: adminA.token, body: { status: 'approved' } });
      const aprobar = await rpc(cfg, adminA.token, 'approve_verification_atomic', { p_verification_id: idAdminA, p_user_id: adminA.id });
      const rechazar = await rpc(cfg, adminA.token, 'reject_verification_atomic', { p_verification_id: idAdminA, p_note: 'yo mismo' });
      const codigos = [directo, aprobar, rechazar].map(codigo);
      esperar(codigos.every((c) => c === 'VC403'), JSON.stringify(codigos));
      const f = await fila(idAdminA);
      esperar(f.status === 'pending', `status=${f.status}`);
      const [p] = await sql(cfg.ref, `select coalesce(is_verified,false) v from public.profiles where id = ${q(adminA.id)}`);
      esperar(p.v === false, 'la insignia se repartio');
      return codigos.join(', ');
    });

    await paso('otro admin si aprueba la solicitud del admin A', async () => {
      const r = await rpc(cfg, adminB.token, 'approve_verification_atomic', { p_verification_id: idAdminA, p_user_id: adminA.id });
      esperar(r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
      esperar((await fila(idAdminA)).status === 'approved', 'no quedo aprobada');
    });

    await paso('ya aprobada por otro, el admin A tampoco puede re-aprobarse (sin transicion de estado)', async () => {
      const r = await rpc(cfg, adminA.token, 'approve_verification_atomic', { p_verification_id: idAdminA, p_user_id: adminA.id });
      esperar(codigo(r) === 'VC403', `${r.status} ${JSON.stringify(r.body)}`);
    });

    await paso('otro admin si rechaza la del vendedor', async () => {
      const r = await rpc(cfg, adminB.token, 'reject_verification_atomic', { p_verification_id: idVendedor, p_note: 'prueba' });
      esperar(r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
      esperar((await fila(idVendedor)).status === 'rejected', 'no quedo rechazada');
    });

    await paso('Storage: reemplazar la foto en la misma ruta mueve updated_at (lo que mira el panel)', async () => {
      const ruta = `${vendedor.id}/selfie`;
      const a = await subir(vendedor.token, ruta);
      esperar(a.ok, `subida 1: ${a.status} ${await a.text()}`);
      const [antes] = (await listar(vendedor.token, vendedor.id)).filter((o) => o.name === 'selfie');
      esperar(antes?.updated_at, `el dueno no ve su objeto al listar: ${JSON.stringify(antes)}`);
      await new Promise((r) => setTimeout(r, 1200));
      const b = await subir(vendedor.token, ruta);
      esperar(b.ok, `subida 2: ${b.status} ${await b.text()}`);
      const [despues] = (await listar(cfg.service, vendedor.id)).filter((o) => o.name === 'selfie');
      esperar(new Date(despues.updated_at) > new Date(antes.updated_at), `${antes.updated_at} -> ${despues.updated_at}`);
      return `${antes.updated_at} -> ${despues.updated_at}`;
    });
  } finally {
    await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [`${vendedor.id}/selfie`] }),
    }).catch(() => {});
    const ids = [vendedor, adminA, adminB].map((u) => q(u.id)).join(', ');
    await sql(cfg.ref, `delete from public.seller_verification where user_id in (${ids});
                        delete from public.trust_level_verification where user_id in (${ids});
                        delete from public.user_roles where user_id in (${ids});`);
    const n = await limpiar(cfg);
    const ok = resultados.filter(Boolean).length;
    console.log(`\nResultado: ${ok}/${resultados.length} pasos OK. Fixtures restantes: ${n}.`);
    process.exitCode = ok === resultados.length ? 0 : 1;
  }
};

main().catch(async (e) => { console.error(`ERROR: ${e.message}`); try { await limpiar(cfg); } catch {} process.exit(2); });
