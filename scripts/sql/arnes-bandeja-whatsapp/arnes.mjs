// Arnes local de la bandeja de WhatsApp: levanta un Postgres embebido, imita lo
// minimo de Supabase que la migracion toca y ejercita los RPC con roles reales.
// Nada de esto toca produccion. Ver README.md.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.resolve(process.argv[2] ?? path.join(AQUI, "..", "..", "..", "supabase", "migrations", "20261108180000_bandeja_whatsapp.sql"));
if (!fs.existsSync(MIGRACION)) {
  console.error(`No existe la migracion: ${MIGRACION}`);
  process.exit(2);
}
const PORT = Number(process.env.PUERTO_ARNES ?? 54329);
const DATA = path.join(AQUI, "data-db");
fs.rmSync(DATA, { recursive: true, force: true });

const servidor = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const A = "00000000-0000-4000-8000-00000000000a"; // negocio con numero
const B = "00000000-0000-4000-8000-00000000000b"; // otro negocio (recibira un segundo numero)
const C = "00000000-0000-4000-8000-00000000000c"; // comprador (no vendedor)
const D = "00000000-0000-4000-8000-00000000000d"; // admin
const E = "00000000-0000-4000-8000-00000000000e"; // vendedor sin numero (para la FK compuesta)
const SECRETO = "secreto-de-prueba";
const PHONE = "123456789012345";
const PHONE_B = "555000111222333";
const WABA = "987654321098765";
const BASE_TS = Math.floor(Date.now() / 1000) - 3600; // hace una hora, en segundos Unix

const firmar = (cuerpo) => "sha256=" + crypto.createHmac("sha256", SECRETO).update(cuerpo, "utf8").digest("hex");

const payloadMensaje = ({ wamid, de = "5215512345678", nombre = "Cliente Uno", texto = "Hola, tienen pan?", ts = String(BASE_TS), tipo = "text", extra = {}, phone = PHONE, contacts }) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: WABA,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550253483", phone_number_id: phone },
          contacts: contacts === undefined ? [{ profile: { name: nombre }, wa_id: de }] : contacts,
          messages: [{ from: de, id: wamid, timestamp: ts, type: tipo, ...(tipo === "text" ? { text: { body: texto } } : extra) }],
        },
      }],
    }],
  });

const payloadEstado = ({ wamid, status, errors, phone = PHONE }) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: WABA,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550253483", phone_number_id: phone },
          statuses: [{ id: wamid, status, timestamp: String(BASE_TS + 100), recipient_id: "5215512345678", ...(errors ? { errors } : {}) }],
        },
      }],
    }],
  });

let fallos = 0;
const ok = (cond, msg, detalle) => {
  if (cond) console.log("  ok  ", msg);
  else { fallos++; console.log("  FALLO", msg, detalle === undefined ? "" : JSON.stringify(detalle)); }
};

async function principal() {
  await servidor.initialise();
  await servidor.start();
  const cliente = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await cliente.connect();
  const q = (sql, params) => cliente.query(sql, params);

  async function como(rol, sub, fn) {
    await q("BEGIN");
    try {
      await q(`SET LOCAL ROLE ${rol}`);
      const claims = sub ? { sub, role: rol } : { role: rol };
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      const r = await fn(q);
      await q("COMMIT");
      return r;
    } catch (e) {
      await q("ROLLBACK");
      throw e;
    }
  }
  async function esperaError(rol, sub, sql, params, codigo, msg) {
    try {
      await como(rol, sub, (q) => q(sql, params));
      ok(false, msg, "no lanzo error");
      return null;
    } catch (e) {
      ok(e.code === codigo, `${msg} [${e.code}: ${String(e.message).slice(0, 100)}]`, e.code);
      return e;
    }
  }
  const ingerir = (cuerpo, firma = firmar(cuerpo)) => como("anon", null, (q) => q(`SELECT public.ingerir_webhook_whatsapp($1,$2) r`, [firma, cuerpo])).then((r) => r.rows[0].r);

  console.log("== imitando lo minimo de Supabase");
  await q(`CREATE ROLE anon NOLOGIN`);
  await q(`CREATE ROLE authenticated NOLOGIN`);
  await q(`CREATE ROLE service_role NOLOGIN BYPASSRLS`);
  await q(`CREATE SCHEMA auth`);
  await q(`CREATE SCHEMA extensions`);
  await q(`CREATE SCHEMA vault`);
  await q(`GRANT USAGE ON SCHEMA extensions, public TO anon, authenticated`);
  await q(`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
             SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $f$`);
  await q(`GRANT USAGE ON SCHEMA auth TO anon, authenticated`);
  await q(`CREATE TABLE vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text, created_at timestamptz default now())`);
  await q(`CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, created_at FROM vault.secrets`);
  await q(`CREATE FUNCTION vault.create_secret(p_secret text, p_name text default null, p_description text default null) RETURNS uuid LANGUAGE sql AS $f$
             INSERT INTO vault.secrets (name, description, secret) VALUES (p_name, p_description, p_secret) RETURNING id $f$`);
  await q(`CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user')`);
  await q(`CREATE TABLE public.profiles (id uuid primary key, email text not null default '', nombre text not null default '', username text unique, nombre_negocio text, es_vendedor boolean default false, is_hidden boolean not null default false)`);
  await q(`ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY`);
  await q(`GRANT SELECT (id, nombre, username, nombre_negocio, es_vendedor) ON public.profiles TO anon, authenticated`);
  await q(`CREATE POLICY p_lee ON public.profiles FOR SELECT TO anon, authenticated USING (true)`);
  await q(`CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, role public.app_role not null default 'user', created_at timestamptz default now(), unique (user_id, role))`);
  await q(`CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $f$
             BEGIN RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role); END $f$`);
  await q(`CREATE PUBLICATION supabase_realtime`);
  await q(`INSERT INTO public.profiles (id, nombre, username, nombre_negocio, es_vendedor) VALUES
             ('${A}', 'Ana', 'panaderia-ana', 'Panaderia Ana', true),
             ('${B}', 'Beto', 'taller-beto', 'Taller Beto', true),
             ('${C}', 'Carla', 'carla', null, false),
             ('${D}', 'Admin', 'admin', null, false),
             ('${E}', 'Eva', 'floreria-eva', 'Floreria Eva', true)`);
  await q(`INSERT INTO public.user_roles (user_id, role) VALUES ('${D}', 'admin')`);

  console.log("== aplicando la migracion");
  const sql = fs.readFileSync(MIGRACION, "utf8");
  ok(!/[^\x00-\x7f]/.test(sql), "la migracion es ASCII puro");
  await q("BEGIN");
  await q(sql);
  await q("COMMIT");
  console.log("  ok   migracion aplicada sin errores");

  console.log("== privilegios y forma");
  const priv = (await q(`SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p
      FROM information_schema.table_privileges
     WHERE table_name IN ('canales_whatsapp','conversaciones_whatsapp','mensajes_whatsapp','eventos_webhook_whatsapp','estados_huerfanos_whatsapp')
       AND grantee IN ('anon','authenticated') GROUP BY 1,2 ORDER BY 2,1`)).rows;
  ok(JSON.stringify(priv) === JSON.stringify([
    { grantee: "authenticated", table_name: "canales_whatsapp", p: "SELECT" },
    { grantee: "authenticated", table_name: "conversaciones_whatsapp", p: "SELECT" },
    { grantee: "authenticated", table_name: "mensajes_whatsapp", p: "SELECT" },
  ]), "solo authenticated SELECT en tres tablas; anon nada; eventos y huerfanos nada", priv);
  const fn = async (rol, f) => (await q(`SELECT has_function_privilege($1, $2, 'EXECUTE') v`, [rol, f])).rows[0].v;
  ok(await fn("anon", "public.ingerir_webhook_whatsapp(text,text)") === true, "anon ejecuta ingerir");
  ok(await fn("anon", "public.preparar_envio_whatsapp(uuid,text)") === false, "anon NO ejecuta preparar_envio");
  ok(await fn("anon", "public.conectar_canal_whatsapp(uuid,text,text,text)") === false, "anon NO ejecuta conectar_canal");
  ok(await fn("anon", "public.eliminar_canal_whatsapp(uuid)") === false, "anon NO ejecuta eliminar_canal");
  ok(await fn("anon", "public.whatsapp_texto_de_mensaje(jsonb)") === false, "anon NO ejecuta el ayudante de texto");
  ok(await fn("authenticated", "public.cerrar_envio_whatsapp(uuid,text,integer,text)") === true, "authenticated ejecuta cerrar_envio");
  const pub = (await q(`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1`)).rows.map((r) => r.tablename);
  ok(JSON.stringify(pub) === JSON.stringify(["conversaciones_whatsapp", "mensajes_whatsapp"]), "publicacion realtime con las dos tablas", pub);
  const rls = (await q(`SELECT tablename FROM pg_tables WHERE rowsecurity AND tablename LIKE '%whatsapp' ORDER BY 1`)).rows.map((r) => r.tablename);
  ok(rls.length === 5, "RLS encendida en las 5 tablas", rls);
  const fks = (await q(`SELECT conname FROM pg_constraint WHERE conname IN ('conversaciones_whatsapp_canal_id_negocio_id_fkey','mensajes_whatsapp_conversacion_id_negocio_id_fkey') ORDER BY 1`)).rows.map((r) => r.conname);
  ok(fks.length === 2, "las dos FK compuestas existen", fks);
  const cfg = (await q(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'ingerir_webhook_whatsapp'`)).rows[0];
  ok(cfg.prosecdef === true && (cfg.proconfig ?? []).some((c) => c.startsWith("search_path=")) && (cfg.proconfig ?? []).some((c) => c.startsWith("statement_timeout=")), "ingerir: definer, search_path vacio y statement_timeout", cfg);

  console.log("== ayudante de texto");
  const texto = async (msg) => (await q(`SELECT public.whatsapp_texto_de_mensaje($1::jsonb) t`, [JSON.stringify(msg)])).rows[0].t;
  ok(await texto({ type: "text", text: { body: "hola" } }) === "hola", "text.body");
  ok(await texto({ type: "image", image: { id: "1", mime_type: "image/jpeg", caption: "mi foto" } }) === "mi foto", "image.caption");
  ok(await texto({ type: "audio", audio: { id: "1" } }) === null, "audio -> null");
  ok(await texto({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "Si" } } }) === "Si", "interactive button_reply.title");
  ok(await texto({ type: "reaction", reaction: { message_id: "w", emoji: "❤️" } }) === "❤️", "reaction.emoji");
  ok((await texto({ type: "text", text: { body: "x".repeat(5000) } })).length === 4096, "texto recortado a 4096");

  console.log("== admin conecta el numero");
  await esperaError("authenticated", A, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, PHONE, WABA, "+1 555 025 3483"], "42501", "un vendedor no admin no puede conectar");
  await esperaError("authenticated", C, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, PHONE, WABA, null], "42501", "un comprador no puede conectar");
  await esperaError("authenticated", D, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [C, PHONE, WABA, null], "22023", "no se conecta a un perfil que no es vendedor");
  const eLetras = await esperaError("authenticated", D, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, "abc", WABA, null], "22023", "phone_number_id con letras se rechaza");
  ok(eLetras && /número/.test(eLetras.message), "los mensajes de error llevan acentos (E'' con escapes)", eLetras && eLetras.message);
  await esperaError("authenticated", D, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, PHONE, WABA, "llamame"], "22023", "numero mostrado con letras se rechaza");
  const canalId = (await como("authenticated", D, (q) => q(`SELECT public.conectar_canal_whatsapp($1,$2,$3,$4) id`, [A, ` ${PHONE} `, WABA, "+1 555 025 3483"]))).rows[0].id;
  ok(typeof canalId === "string" && canalId.length === 36, "el admin conecta el numero de prueba a Ana", canalId);
  const canalId2 = (await como("authenticated", D, (q) => q(`SELECT public.conectar_canal_whatsapp($1,$2,$3,$4) id`, [A, PHONE, WABA, "+1 555 025 3483"]))).rows[0].id;
  ok(canalId2 === canalId, "volver a conectar el mismo numero al mismo negocio es idempotente");
  await esperaError("authenticated", D, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [B, PHONE, WABA, null], "23505", "el mismo numero no se conecta a otro negocio");
  await esperaError("authenticated", D, `SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, PHONE_B, WABA, null], "23505", "un negocio no tiene dos numeros");
  const canalB = (await como("authenticated", D, (q) => q(`SELECT public.conectar_canal_whatsapp($1,$2,$3,$4) id`, [B, PHONE_B, WABA, null]))).rows[0].id;
  ok(typeof canalB === "string", "el admin conecta un segundo numero a Beto");

  const canalesA = (await como("authenticated", A, (q) => q(`SELECT id, negocio_id, estado FROM public.canales_whatsapp`))).rows;
  ok(canalesA.length === 1 && canalesA[0].id === canalId, "Ana ve solo su canal por RLS");
  const canalesD = (await como("authenticated", D, (q) => q(`SELECT id FROM public.canales_whatsapp`))).rows;
  ok(canalesD.length === 2, "el admin ve los canales");

  console.log("== webhook sin secreto en Vault");
  const cuerpo1 = payloadMensaje({ wamid: "wamid.HBgLNTIxNTUxMjM0NTY3OBUCABIYFjNFQjBDMUM3NkY4NkNBNjhBQjQ4RjMA" });
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, [firmar(cuerpo1), cuerpo1], "55000", "sin secreto en Vault -> 55000");
  await q(`SELECT vault.create_secret($1, 'whatsapp_app_secret', 'prueba')`, [SECRETO]);

  console.log("== webhook: firma (codigo propio P0401)");
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, [null, cuerpo1], "P0401", "sin firma -> P0401");
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, ["sha256=zz", cuerpo1], "P0401", "firma mal formada -> P0401");
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, ["sha256=" + "0".repeat(64), cuerpo1], "P0401", "firma que no coincide -> P0401");
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, [firmar(cuerpo1 + " "), cuerpo1], "P0401", "firma de otro cuerpo -> P0401");
  await esperaError("anon", null, `SELECT public.ingerir_webhook_whatsapp($1,$2)`, [firmar("{no es json"), "{no es json"], "22023", "cuerpo no JSON firmado -> 22023");
  const nadaEscrito = (await q(`SELECT count(*)::int n FROM public.eventos_webhook_whatsapp`)).rows[0].n;
  ok(nadaEscrito === 0, "nada se escribio con firmas invalidas");
  const conPrefijoMayus = await ingerir(cuerpo1, firmar(cuerpo1).toUpperCase().replace("SHA256=", "sha256=").replace("sha256=", "SHA256="));
  ok(conPrefijoMayus.nuevos === 1, "la firma se acepta con prefijo y hex en mayusculas", conPrefijoMayus);

  console.log("== webhook: mensajes entrantes");
  let r = await ingerir(cuerpo1);
  ok(r.duplicado === true && r.nuevos === 0, "mismo cuerpo otra vez: duplicado", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.HBgLNTIxNTUxMjM0NTY3OBUCABIYFjNFQjBDMUM3NkY4NkNBNjhBQjQ4RjMA", texto: "Hola, tienen pan?", ts: String(BASE_TS + 1) }));
  ok(r.nuevos === 0 && r.duplicado === false, "mismo wamid en otro cuerpo: no se duplica el mensaje", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.SEGUNDO000000000000000000", texto: "y conchas?", ts: String(BASE_TS + 60), nombre: "Cliente Uno Actualizado" }));
  ok(r.nuevos === 1, "segundo mensaje del mismo cliente", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.IMAGEN00000000000000000000", tipo: "image", extra: { image: { id: "9", mime_type: "image/jpeg", sha256: "x", caption: "foto del pastel" } }, ts: String(BASE_TS + 120) }));
  ok(r.nuevos === 1, "imagen con pie", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.RARO000000000000000000000", tipo: "lo_que_sea", extra: {}, ts: String(BASE_TS + 180), de: "5219998887766", nombre: "Otro Cliente" }));
  ok(r.nuevos === 1, "tipo desconocido se guarda como unknown", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.OTRONUMERO000000000000000", phone: "999999999999" }));
  ok(r.sin_canal === 1 && r.nuevos === 0, "numero no conectado: sin_canal", r);
  const recortado = (await q(`SELECT cuerpo FROM public.eventos_webhook_whatsapp WHERE resultado->>'sin_canal' = '1'`)).rows[0].cuerpo;
  ok(recortado.redactado === true && !("entry" in recortado) && JSON.stringify(recortado.phone_number_ids) === JSON.stringify(["999999999999"]), "el evento de un numero no conectado queda recortado (sin contenido)", recortado);
  const completo = (await q(`SELECT cuerpo FROM public.eventos_webhook_whatsapp WHERE resultado->>'nuevos' = '1' LIMIT 1`)).rows[0].cuerpo;
  ok("entry" in completo && !("redactado" in completo), "el evento que si dejo mensajes conserva su cuerpo", Object.keys(completo));
  r = await ingerir(JSON.stringify({ object: "page", entry: [] }));
  ok(r.ignorados === 1 && r.nuevos === 0, "objeto que no es whatsapp_business_account: ignorado", r);
  r = await ingerir(JSON.stringify({ entry: [] }));
  ok(r.ignorados === 1 && r.nuevos === 0, "cuerpo sin 'object': ignorado (IS DISTINCT FROM)", r);
  r = await ingerir(JSON.stringify({ object: "whatsapp_business_account", entry: { no: "array" } }));
  ok(r.ignorados === 1 && r.nuevos === 0, "entry que no es array: ignorado sin error", r);
  r = await ingerir(payloadMensaje({ wamid: "corto", ts: String(BASE_TS + 200) }));
  ok(r.ignorados === 1 && r.nuevos === 0, "wamid invalido: ignorado", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.DEINVALIDO000000000000000", de: "+52 55 1234", ts: String(BASE_TS + 201) }));
  ok(r.ignorados === 1 && r.nuevos === 0, "from con + y espacios: ignorado", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.EDIT0000000000000000000000", tipo: "edit", extra: { edit: { original_message_id: "x" } }, ts: String(BASE_TS + 202) }));
  ok(r.ignorados === 1 && r.nuevos === 0, "edit se ignora", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.SINCONTACTS0000000000000", de: "5217771112233", contacts: {}, ts: String(BASE_TS + 203), texto: "sin lista de contactos" }));
  ok(r.nuevos === 1, "contacts que no es array no rompe: el mensaje se guarda", r);
  const sinNombre = (await q(`SELECT nombre_perfil FROM public.conversaciones_whatsapp WHERE wa_id = '5217771112233'`)).rows[0];
  ok(sinNombre.nombre_perfil === null, "y la conversacion queda sin nombre de perfil", sinNombre);
  // "\u0000" en JS es un NUL real; JSON.stringify lo escribe como \u0000 en el cuerpo, igual que Meta.
  r = await ingerir(payloadMensaje({ wamid: "wamid.NUL00000000000000000000000", de: "5217771112233", texto: "con nulo \u0000 dentro", ts: String(BASE_TS + 204) }));
  ok(r.nuevos === 1, "un \\u0000 en el texto no rompe el jsonb", r);
  r = await ingerir(payloadMensaje({ wamid: "wamid.BARRA0000000000000000000000", de: "5217771112233", texto: "ruta C:\\\\u0000 literal", ts: String(BASE_TS + 205) }));
  ok(r.nuevos === 1, "una barra escapada seguida de u0000 (texto literal) tampoco rompe", r);
  const conBarra = (await q(`SELECT texto FROM public.mensajes_whatsapp WHERE wamid = 'wamid.BARRA0000000000000000000000'`)).rows[0];
  // En el JSON iban dos barras escapadas + u0000: al decodificar quedan dos barras literales + u0000.
  ok(conBarra.texto === "ruta C:\\\\u0000 literal", "y el texto literal (barras escapadas) se conserva tal cual", conBarra);
  const sinNul = (await q(`SELECT texto FROM public.mensajes_whatsapp WHERE wamid = 'wamid.NUL00000000000000000000000'`)).rows[0];
  ok(sinNul.texto === "con nulo  dentro", "y se guarda sin el NUL", sinNul);
  r = await ingerir(payloadMensaje({ wamid: "wamid.FUTURO00000000000000000000", de: "5217771112233", ts: "999999999999" }));
  ok(r.nuevos === 1, "timestamp del futuro se acepta", r);
  const futuro = (await q(`SELECT ultimo_entrante_at <= now() + interval '5 minutes' AS acotado FROM public.conversaciones_whatsapp WHERE wa_id = '5217771112233'`)).rows[0];
  ok(futuro.acotado === true, "pero se acota a ahora + 5 minutos", futuro);
  r = await ingerir(payloadMensaje({ wamid: "wamid.VIEJO000000000000000000000", texto: "mensaje viejo que llega tarde", ts: String(BASE_TS - 7200) }));
  ok(r.nuevos === 1, "un aviso viejo fuera de orden se guarda", r);
  const convA1 = (await q(`SELECT ultimo_mensaje_texto, no_leidos FROM public.conversaciones_whatsapp WHERE wa_id = '5215512345678'`)).rows[0];
  ok(convA1.ultimo_mensaje_texto === "foto del pastel", "pero no pisa el texto del ultimo mensaje mas reciente", convA1);

  const convsA = (await como("authenticated", A, (q) => q(`SELECT id, wa_id, nombre_perfil, ultimo_mensaje_texto, no_leidos, ultimo_entrante_at FROM public.conversaciones_whatsapp ORDER BY wa_id`))).rows;
  ok(convsA.length === 3, "Ana ve 3 conversaciones", convsA.map((c) => c.wa_id));
  const c1 = convsA.find((c) => c.wa_id === "5215512345678");
  ok(c1 && c1.no_leidos === 4 && c1.nombre_perfil === "Cliente Uno", "contadores y el nombre del ultimo aviso que lo trajo", c1);
  ok(c1 && new Date(c1.ultimo_entrante_at).getTime() === (BASE_TS + 120) * 1000, "ultimo_entrante_at = timestamp de Meta del ultimo mensaje real", c1 && c1.ultimo_entrante_at);
  const c2 = convsA.find((c) => c.wa_id === "5219998887766");
  ok(c2 && c2.ultimo_mensaje_texto === "[unknown]", "sin texto: el tipo entre corchetes", c2);
  const convsB = (await como("authenticated", B, (q) => q(`SELECT id FROM public.conversaciones_whatsapp`))).rows;
  ok(convsB.length === 0, "Beto no ve conversaciones de Ana");
  const convsD = (await como("authenticated", D, (q) => q(`SELECT id FROM public.conversaciones_whatsapp`))).rows;
  ok(convsD.length === 0, "el admin NO ve conversaciones");
  const msgsA = (await como("authenticated", A, (q) => q(`SELECT tipo, texto, estado, direccion FROM public.mensajes_whatsapp ORDER BY marca_tiempo`))).rows;
  ok(msgsA.length === 9 && msgsA.every((m) => m.estado === "recibido" && m.direccion === "entrante"), "Ana ve sus 9 mensajes entrantes", msgsA.length);
  await esperaError("anon", null, `SELECT * FROM public.eventos_webhook_whatsapp`, [], "42501", "anon no lee eventos");
  await esperaError("authenticated", A, `SELECT * FROM public.estados_huerfanos_whatsapp`, [], "42501", "authenticated no lee estados huerfanos");

  console.log("== responder");
  const convId = c1.id;
  const eAjena = await esperaError("authenticated", B, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "hola"], "P0002", "Beto no puede responder en la conversacion de Ana");
  ok(eAjena && /encontró/.test(eAjena.message), "el P0002 viene con acentos", eAjena && eAjena.message);
  await esperaError("anon", null, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "hola"], "42501", "anon no puede preparar (sin EXECUTE)");
  await esperaError("authenticated", A, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "   "], "22023", "texto vacio se rechaza");
  await esperaError("authenticated", A, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "x".repeat(4097)], "22023", "texto de 4097 se rechaza");
  await q(`UPDATE public.conversaciones_whatsapp SET ultimo_entrante_at = now() - interval '25 hours' WHERE id = $1`, [convId]);
  await esperaError("authenticated", A, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "hola"], "55000", "ventana de 24 h cerrada -> 55000");
  await q(`UPDATE public.conversaciones_whatsapp SET ultimo_entrante_at = now() - interval '1 hour' WHERE id = $1`, [convId]);
  const prep = (await como("authenticated", A, (q) => q(`SELECT public.preparar_envio_whatsapp($1,$2) r`, [convId, "  Claro que si, hay pan recien hecho.  "]))).rows[0].r;
  ok(prep.mensaje_id && prep.phone_number_id === PHONE && prep.wa_id === "5215512345678" && prep.texto === "Claro que si, hay pan recien hecho.", "preparar devuelve id, numero, destino y texto limpio", prep);
  const pend = (await q(`SELECT estado, wamid, enviado_por FROM public.mensajes_whatsapp WHERE id = $1`, [prep.mensaje_id])).rows[0];
  ok(pend.estado === "pendiente" && pend.wamid === null && pend.enviado_por === A, "queda pendiente, sin wamid, con autor", pend);
  const cerradoAjeno = (await como("authenticated", B, (q) => q(`SELECT public.cerrar_envio_whatsapp($1,$2) r`, [prep.mensaje_id, "wamid.ENVIADO0000000000000000000"]))).rows[0].r;
  ok(cerradoAjeno === false, "Beto no puede cerrar el envio de Ana");
  await esperaError("authenticated", A, `SELECT public.cerrar_envio_whatsapp($1,$2)`, [prep.mensaje_id, "mal wamid con espacios"], "22023", "wamid invalido al cerrar -> 22023");

  console.log("== carrera: el estado de Meta llega ANTES de cerrar el envio");
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "sent" }));
  ok(r.estados === 0 && r.estados_sin_mensaje === 1, "sent sin fila todavia: queda como huerfano", r);
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "delivered" }));
  ok(r.estados === 0 && r.estados_sin_mensaje === 1, "delivered sin fila: huerfano actualizado", r);
  const huerfano = (await q(`SELECT estado FROM public.estados_huerfanos_whatsapp WHERE wamid = 'wamid.ENVIADO0000000000000000000'`)).rows[0];
  ok(huerfano && huerfano.estado === "entregado", "el huerfano guarda el de mayor rango", huerfano);
  const cerrado = (await como("authenticated", A, (q) => q(`SELECT public.cerrar_envio_whatsapp($1,$2) r`, [prep.mensaje_id, "wamid.ENVIADO0000000000000000000"]))).rows[0].r;
  ok(cerrado === true, "Ana cierra el envio");
  const env = (await q(`SELECT m.estado, m.wamid, c.ultimo_mensaje_texto FROM public.mensajes_whatsapp m JOIN public.conversaciones_whatsapp c ON c.id = m.conversacion_id WHERE m.id = $1`, [prep.mensaje_id])).rows[0];
  ok(env.estado === "entregado" && env.wamid === "wamid.ENVIADO0000000000000000000" && env.ultimo_mensaje_texto === "Claro que si, hay pan recien hecho.", "al cerrar se aplica el estado huerfano (entregado) y la conversacion refleja el texto", env);
  const huerfanosRestantes = (await q(`SELECT count(*)::int n FROM public.estados_huerfanos_whatsapp`)).rows[0].n;
  ok(huerfanosRestantes === 0, "y el huerfano se consume", huerfanosRestantes);
  const cerradoOtraVez = (await como("authenticated", A, (q) => q(`SELECT public.cerrar_envio_whatsapp($1,$2) r`, [prep.mensaje_id, "wamid.ENVIADO0000000000000000000"]))).rows[0].r;
  ok(cerradoOtraVez === false, "cerrar dos veces no hace nada");

  console.log("== estados por webhook");
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "sent" }));
  ok(r.estados === 0 && r.estados_sin_mensaje === 0, "sent despues de entregado: no retrocede ni es huerfano", r);
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "read" }));
  ok(r.estados === 1, "read -> leido", r);
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "played" }));
  ok(r.estados === 0 && r.ignorados === 1, "played (audio) se ignora sin error", r);
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message", error_data: { details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." } }] }));
  ok(r.estados === 1, "failed siempre aplica", r);
  const fallido = (await q(`SELECT estado, error_codigo, error_detalle FROM public.mensajes_whatsapp WHERE id = $1`, [prep.mensaje_id])).rows[0];
  ok(fallido.estado === "fallido" && fallido.error_codigo === 131047 && fallido.error_detalle.startsWith("Re-engagement message Message failed"), "fallido con codigo y detalle", fallido);
  r = await ingerir(payloadEstado({ wamid: "wamid.HBgLNTIxNTUxMjM0NTY3OBUCABIYFjNFQjBDMUM3NkY4NkNBNjhBQjQ4RjMA", status: "read" }));
  ok(r.estados === 0 && r.estados_sin_mensaje === 0, "un estado de un mensaje ENTRANTE no toca nada ni es huerfano", r);
  r = await ingerir(payloadEstado({ wamid: "wamid.ENVIADO0000000000000000000", status: "read", phone: PHONE_B }));
  ok(r.estados === 0 && r.estados_sin_mensaje === 0, "un estado de un mensaje de Ana bajo el numero de Beto no toca nada", r);

  console.log("== read sin delivered y cierre como fallido");
  const prep2 = (await como("authenticated", A, (q) => q(`SELECT public.preparar_envio_whatsapp($1,$2) r`, [convId, "segundo"]))).rows[0].r;
  await como("authenticated", A, (q) => q(`SELECT public.cerrar_envio_whatsapp($1,$2)`, [prep2.mensaje_id, "wamid.SEGUNDOENVIO000000000000000"]));
  r = await ingerir(payloadEstado({ wamid: "wamid.SEGUNDOENVIO000000000000000", status: "read" }));
  const leidoDirecto = (await q(`SELECT estado FROM public.mensajes_whatsapp WHERE id = $1`, [prep2.mensaje_id])).rows[0];
  ok(r.estados === 1 && leidoDirecto.estado === "leido", "read sin delivered previo: salta a leido", leidoDirecto);
  const prep3 = (await como("authenticated", A, (q) => q(`SELECT public.preparar_envio_whatsapp($1,$2) r`, [convId, "tercero"]))).rows[0].r;
  const cerrado3 = (await como("authenticated", A, (q) => q(`SELECT public.cerrar_envio_whatsapp($1, NULL, $2, $3) r`, [prep3.mensaje_id, 190, "  Error validating access token  "]))).rows[0].r;
  const f3 = (await q(`SELECT estado, error_codigo, error_detalle, wamid FROM public.mensajes_whatsapp WHERE id = $1`, [prep3.mensaje_id])).rows[0];
  ok(cerrado3 === true && f3.estado === "fallido" && f3.error_codigo === 190 && f3.error_detalle === "Error validating access token" && f3.wamid === null, "fallo de Meta queda registrado", f3);

  console.log("== ritmo");
  let ritmoError = null;
  for (let i = 0; i < 31; i++) {
    try { await como("authenticated", A, (q) => q(`SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, `msg ${i}`])); }
    catch (e) { ritmoError = e; break; }
  }
  ok(ritmoError && ritmoError.code === "55000", "a los 30 salientes por minuto el RPC frena", ritmoError && ritmoError.code);

  console.log("== marcar leida");
  const leidaB = (await como("authenticated", B, (q) => q(`SELECT public.marcar_leida_conversacion_whatsapp($1) r`, [convId]))).rows[0].r;
  ok(leidaB === null, "Beto no marca ni obtiene wamid");
  const noLeidosAntes = (await q(`SELECT no_leidos FROM public.conversaciones_whatsapp WHERE id = $1`, [convId])).rows[0].no_leidos;
  ok(noLeidosAntes === 4, "no_leidos sigue en 4 tras el intento de Beto", noLeidosAntes);
  const leidaA = (await como("authenticated", A, (q) => q(`SELECT public.marcar_leida_conversacion_whatsapp($1) r`, [convId]))).rows[0].r;
  ok(leidaA === "wamid.IMAGEN00000000000000000000", "Ana obtiene el wamid del ultimo entrante real", leidaA);
  const noLeidosDespues = (await q(`SELECT no_leidos FROM public.conversaciones_whatsapp WHERE id = $1`, [convId])).rows[0].no_leidos;
  ok(noLeidosDespues === 0, "no_leidos en 0", noLeidosDespues);

  console.log("== pausar (solo admin; sigue recibiendo, no responde)");
  await esperaError("authenticated", A, `SELECT public.cambiar_estado_canal_whatsapp($1,false)`, [canalId], "42501", "el dueno NO puede pausar ni reactivar su canal");
  await esperaError("authenticated", B, `SELECT public.cambiar_estado_canal_whatsapp($1,false)`, [canalId], "42501", "otro vendedor tampoco");
  const pausado = (await como("authenticated", D, (q) => q(`SELECT public.cambiar_estado_canal_whatsapp($1,false) r`, [canalId]))).rows[0].r;
  ok(pausado === true, "el admin pausa el canal de Ana");
  r = await ingerir(payloadMensaje({ wamid: "wamid.PAUSADO0000000000000000000", ts: String(BASE_TS + 300), texto: "escribo durante la pausa" }));
  ok(r.nuevos === 1, "con el canal pausado el webhook SIGUE guardando", r);
  await esperaError("authenticated", A, `SELECT public.preparar_envio_whatsapp($1,$2)`, [convId, "hola"], "55000", "con el canal pausado no se responde");
  const reactivado = (await como("authenticated", D, (q) => q(`SELECT public.cambiar_estado_canal_whatsapp($1,true) r`, [canalId]))).rows[0].r;
  ok(reactivado === true, "el admin reactiva");
  const reconectado = (await como("authenticated", D, (q) => q(`SELECT public.cambiar_estado_canal_whatsapp($1,false) r`, [canalId]))).rows[0].r;
  await como("authenticated", D, (q) => q(`SELECT public.conectar_canal_whatsapp($1,$2,$3,$4)`, [A, PHONE, WABA, null]));
  const estadoTrasReconectar = (await q(`SELECT estado FROM public.canales_whatsapp WHERE id = $1`, [canalId])).rows[0].estado;
  ok(reconectado === true && estadoTrasReconectar === "pausado", "volver a conectar no deshace una pausa del admin", estadoTrasReconectar);
  await como("authenticated", D, (q) => q(`SELECT public.cambiar_estado_canal_whatsapp($1,true)`, [canalId]));

  console.log("== FK compuestas: el negocio de conversaciones y mensajes sigue al canal");
  await q(`UPDATE public.canales_whatsapp SET negocio_id = $1 WHERE id = $2`, [E, canalId]);
  const migrados = (await q(`SELECT (SELECT count(*)::int FROM public.conversaciones_whatsapp WHERE negocio_id = $1) c, (SELECT count(*)::int FROM public.mensajes_whatsapp WHERE negocio_id = $1) m, (SELECT count(*)::int FROM public.conversaciones_whatsapp WHERE negocio_id = $2) viejas`, [E, A])).rows[0];
  ok(migrados.c === 3 && migrados.m > 0 && migrados.viejas === 0, "reasignar el canal a mano arrastra negocio_id en conversaciones y mensajes (ON UPDATE CASCADE)", migrados);
  await q(`UPDATE public.canales_whatsapp SET negocio_id = $1 WHERE id = $2`, [A, canalId]);
  await esperaError("postgres", null, `UPDATE public.conversaciones_whatsapp SET negocio_id = $1 WHERE id = $2`, [B, convId], "23503", "una conversacion no puede apuntar a un negocio distinto del de su canal");

  console.log("== desconectar un canal (solo admin, en cascada)");
  r = await ingerir(payloadMensaje({ wamid: "wamid.PARABETO000000000000000000", phone: PHONE_B, de: "5214445556677", nombre: "Cliente de Beto", ts: String(BASE_TS + 400) }));
  ok(r.nuevos === 1, "un mensaje al numero de Beto se guarda", r);
  await esperaError("authenticated", B, `SELECT public.eliminar_canal_whatsapp($1)`, [canalB], "42501", "el dueno no puede desconectar su canal");
  const eliminado = (await como("authenticated", D, (q) => q(`SELECT public.eliminar_canal_whatsapp($1) r`, [canalB]))).rows[0].r;
  const restosB = (await q(`SELECT (SELECT count(*)::int FROM public.canales_whatsapp WHERE id = $1) c, (SELECT count(*)::int FROM public.conversaciones_whatsapp WHERE negocio_id = $2) v, (SELECT count(*)::int FROM public.mensajes_whatsapp WHERE negocio_id = $2) m`, [canalB, B])).rows[0];
  ok(eliminado === true && restosB.c === 0 && restosB.v === 0 && restosB.m === 0, "el admin desconecta y se borran canal, conversaciones y mensajes", restosB);
  const reconectaB = (await como("authenticated", D, (q) => q(`SELECT public.conectar_canal_whatsapp($1,$2,$3,$4) id`, [E, PHONE_B, WABA, null]))).rows[0].id;
  ok(typeof reconectaB === "string", "y el numero se puede conectar a otro negocio");

  console.log("== purgas (SQL de los jobs, ejecutado a mano)");
  await q(`UPDATE public.eventos_webhook_whatsapp SET recibido_at = now() - interval '8 days'`);
  const borrados = (await q(`DELETE FROM public.eventos_webhook_whatsapp WHERE recibido_at < now() - interval '7 days'`)).rowCount;
  ok(borrados > 0, `la purga de eventos borra (${borrados})`);
  const borradosMsg = (await q(`DELETE FROM public.mensajes_whatsapp WHERE marca_tiempo < now() - interval '180 days'`)).rowCount;
  ok(borradosMsg === 0, "la purga de mensajes no borra lo reciente");
  const convVieja = (await q(`SELECT id FROM public.conversaciones_whatsapp WHERE wa_id = '5219998887766'`)).rows[0].id;
  await q(`DELETE FROM public.mensajes_whatsapp WHERE conversacion_id = $1`, [convVieja]);
  await q(`UPDATE public.conversaciones_whatsapp SET ultimo_mensaje_at = now() - interval '181 days' WHERE id = $1`, [convVieja]);
  await q(`UPDATE public.conversaciones_whatsapp SET ultimo_mensaje_at = now() - interval '181 days' WHERE id = $1`, [convId]);
  const borradasConv = (await q(`DELETE FROM public.conversaciones_whatsapp c WHERE coalesce(c.ultimo_mensaje_at, c.created_at) < now() - interval '180 days' AND NOT EXISTS (SELECT 1 FROM public.mensajes_whatsapp m WHERE m.conversacion_id = c.id)`)).rowCount;
  const sigueConMensajes = (await q(`SELECT count(*)::int n FROM public.conversaciones_whatsapp WHERE id = $1`, [convId])).rows[0].n;
  ok(borradasConv === 1 && sigueConMensajes === 1, "la purga de conversaciones borra la vieja sin mensajes y conserva la que aun tiene", { borradasConv, sigueConMensajes });

  await cliente.end();
  await servidor.stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

principal().catch(async (e) => {
  console.error("ERROR", e.code ?? "", e.message, e.position ? `pos ${e.position}` : "", e.where ?? "");
  try { await servidor.stop(); } catch {}
  process.exit(1);
});
