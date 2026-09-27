/**
 * Fixtures sinteticos del STAGING (PT02). Todo lo que crea se reconoce por el
 * dominio `@staging.vicino.test` y el prefijo `[FIXTURE]` en los titulos, y
 * `limpiar()` lo retira por esas marcas. Nunca cuentas reales, nunca el seed.
 *
 * Usuarios: por GoTrue admin (claves del staging). Productos, bloqueos y
 * suspension: por SQL como postgres en el staging, porque son precondiciones
 * del escenario, no lo que se prueba.
 */
import crypto from 'node:crypto';
import { readConfig, sql } from './lib.mjs';

export const DOMINIO = 'staging.vicino.test';
const PUEBLA = { lat: 19.0414, lng: -98.2063 };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const staging = () => {
  const cfg = readConfig();
  if (!cfg?.url || !cfg.anon || !cfg.service) throw new Error('Staging sin claves. Corre scripts/staging/crear.mjs');
  return cfg;
};

/** Respuesta cruda de PostgREST/GoTrue: { status, body }. Nunca lanza. */
export const http = async (cfg, method, route, { token, body, prefer } = {}) => {
  const res = await fetch(`${cfg.url}${route}`, {
    method,
    headers: {
      apikey: cfg.anon,
      Authorization: `Bearer ${token ?? cfg.anon}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

export const rpc = (cfg, token, fn, args) => http(cfg, 'POST', `/rest/v1/rpc/${fn}`, { token, body: args });

const admin = async (cfg, method, route, body) => {
  const res = await fetch(`${cfg.url}${route}`, {
    method,
    headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GoTrue admin ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

/** Usuario confirmado + sesion. Devuelve { id, email, token }. */
export const crearUsuario = async (cfg, etiqueta) => {
  const email = `${etiqueta}-${crypto.randomBytes(4).toString('hex')}@${DOMINIO}`;
  const password = crypto.randomBytes(18).toString('base64url');
  const u = await admin(cfg, 'POST', '/auth/v1/admin/users', {
    email, password, email_confirm: true, user_metadata: { full_name: `Fixture ${etiqueta}` },
  });
  const login = await http(cfg, 'POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  if (login.status !== 200) throw new Error(`login ${etiqueta}: ${login.status} ${JSON.stringify(login.body)}`);
  // password solo vive en memoria del proceso: la usa el E2E para entrar por la UI.
  return { id: u.id, email, password, token: login.body.access_token };
};

/** Perfil listo para usar la app: sin redireccion al onboarding. */
export const completarOnboarding = (cfg, id) =>
  sql(
    cfg.ref,
    `update public.profiles set has_seen_onboarding = true, onboarding_paso = null,
       ubicacion_lat = ${PUEBLA.lat}, ubicacion_lng = ${PUEBLA.lng}, ubicacion = 'Puebla, Pue.'
     where id = ${q(id)}`
  );

/** Producto del fixture, con ubicacion dentro de la cobertura. */
export const crearProducto = async (cfg, creadorId, { titulo, estatus = 'disponible', oculto = false, precio = 150 } = {}) => {
  const [cat] = await sql(cfg.ref, 'select slug from public.categories order by slug limit 1');
  const [row] = await sql(
    cfg.ref,
    `insert into public.products_services
       (creador_id, titulo, descripcion, categoria, precio, estatus, is_hidden, ubicacion_geo)
     values (${q(creadorId)}, ${q(`[FIXTURE] ${titulo}`)}, 'Producto sintetico de pruebas', ${q(cat?.slug ?? 'otros')},
             ${precio}, ${q(estatus)}, ${oculto},
             ST_SetSRID(ST_MakePoint(${PUEBLA.lng}, ${PUEBLA.lat}), 4326)::geography)
     returning id`
  );
  // contadores_nacen_en_cero fuerza is_hidden = false al INSERT (la
  // moderacion no la decide quien publica): el oculto se aplica despues.
  if (oculto) await sql(cfg.ref, `update public.products_services set is_hidden = true where id = ${q(row.id)}`);
  return row.id;
};

export const bloquear = (cfg, bloqueador, bloqueado) =>
  sql(cfg.ref, `insert into public.user_blocks (blocker_id, blocked_id) values (${q(bloqueador)}, ${q(bloqueado)}) on conflict do nothing`);
export const desbloquear = (cfg, bloqueador, bloqueado) =>
  sql(cfg.ref, `delete from public.user_blocks where blocker_id = ${q(bloqueador)} and blocked_id = ${q(bloqueado)}`);
export const suspender = (cfg, id, valor = true) =>
  sql(cfg.ref, `update public.profiles set is_hidden = ${valor} where id = ${q(id)}`);

/**
 * Solicitud de compra abierta en Puebla (pasa exigir_cobertura), con sus
 * categorias por slug (el trigger del pivote admite hasta 3). Devuelve el id.
 */
export const crearSolicitud = async (cfg, compradorId, { titulo, slugs = [], descripcion = 'Solicitud sintetica de pruebas' } = {}) => {
  const [row] = await sql(
    cfg.ref,
    `insert into public.purchase_requests (buyer_id, title, description, status, expires_at, ubicacion_geo)
     values (${q(compradorId)}, ${q(`[FIXTURE] ${titulo}`)}, ${q(descripcion)}, 'open', now() + interval '48 hours',
             ST_SetSRID(ST_MakePoint(${PUEBLA.lng}, ${PUEBLA.lat}), 4326)::geography)
     returning id`
  );
  if (slugs.length > 0) {
    const filas = await sql(
      cfg.ref,
      `insert into public.purchase_request_categories (request_id, categoria_id)
       select ${q(row.id)}, c.id from public.categories c where c.slug in (${slugs.map(q).join(', ')})
       returning categoria_id`
    );
    if (filas.length !== slugs.length) throw new Error(`crearSolicitud: ${filas.length}/${slugs.length} categorias (${slugs})`);
  }
  return row.id;
};

/** Lectura como postgres (evidencia que el cliente no puede falsear). */
export const leer = (cfg, query) => sql(cfg.ref, query);

/** Retira TODO lo del fixture: usuarios del dominio y lo que cuelga de ellos. */
export const limpiar = async (cfg) => {
  const ids = `(select id from auth.users where email like ${q(`%@${DOMINIO}`)})`;
  await sql(
    cfg.ref,
    `begin;
     delete from public.messages where chat_id in (select id from public.chats where comprador_id in ${ids} or vendedor_id in ${ids});
     delete from public.sale_confirmations where buyer_id in ${ids} or seller_id in ${ids};
     delete from public.chats where comprador_id in ${ids} or vendedor_id in ${ids};
     delete from public.favorites where usuario_id in ${ids};
     delete from public.user_blocks where blocker_id in ${ids} or blocked_id in ${ids};
     delete from public.products_services where creador_id in ${ids};
     delete from public.request_responses where seller_id in ${ids};
     delete from public.purchase_requests where buyer_id in ${ids};
     delete from auth.users where id in ${ids};
     commit;`
  );
  // Usuarios del dominio + solicitudes [FIXTURE] que hayan quedado (p. ej. de
  // un comprador que no era fixture). Sigue siendo un numero: lo leen 5 scripts.
  const [r] = await sql(
    cfg.ref,
    `select (select count(*) from auth.users where email like ${q(`%@${DOMINIO}`)})
          + (select count(*) from public.purchase_requests where title like '[FIXTURE]%') as n`
  );
  return Number(r.n);
};
