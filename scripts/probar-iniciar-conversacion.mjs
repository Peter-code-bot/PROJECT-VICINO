#!/usr/bin/env node
/**
 * Pruebas por HTTP del contrato iniciar_conversacion (20260912300000), con
 * peticiones REALES y CONCURRENTES contra un Supabase de pruebas (local con
 * `supabase start`, o un proyecto de pruebas). NUNCA contra produccion: cada
 * caso escribe chats y mensajes de verdad. El script se niega a correr si la
 * URL apunta al proyecto de produccion.
 *
 *   VICINO_PRUEBAS_JSON=/ruta/credenciales.json node scripts/probar-iniciar-conversacion.mjs
 *
 * El JSON: { "url", "anon", "productoId", "users": { "vendedor": { "id" } } }.
 * O por variables sueltas: VICINO_PRUEBAS_URL, VICINO_PRUEBAS_ANON_KEY,
 * VICINO_PRUEBAS_VENDEDOR_ID, VICINO_PRUEBAS_PRODUCTO_ID (producto disponible
 * de ese vendedor).
 *
 * LOS COMPRADORES SE CREAN EN CADA CORRIDA (signup por GoTrue con correo
 * aleatorio; el entorno de pruebas tiene que tener la autoconfirmacion de
 * correo activa, como la tiene `supabase start`). Es lo que hace el harness
 * repetible: la RPC impone 30 intenciones por cuenta y 24 h, la cuota no se
 * puede resetear por REST, y con usuarios fijos la tercera corrida del dia
 * fallaba con 23514 pareciendo una regresion. Si el signup no devuelve
 * sesion, el script aborta con codigo 2 y lo dice.
 *
 * Casos (lo que pidio Alejandro el 6-sep):
 *   A. doble solicitud SIMULTANEA con la misma clave  -> mismo chat, mismo mensaje, 1 fila
 *   B. reintento con la misma clave                  -> repetida, sin filas nuevas
 *   C. operacion nueva (clave nueva)                 -> mensaje nuevo en el mismo chat
 *   D. usuario no autorizado                         -> anon 401; contigo mismo 22023;
 *                                                       producto ajeno PT404; compra sin clave 22023;
 *                                                       misma clave con otro producto PT409;
 *                                                       INSERT directo forjando el aviso 42501
 *   E. fallo sin rastro                              -> PT404 antes de escribir: no aparece chat
 *   F. 10 claves distintas en paralelo               -> 10 mensajes, 1 chat
 *   G. cuota                                         -> 30 en paralelo entran, la 31.a da 23514
 *                                                       y no deja bump de updated_at (se deshace todo)
 *
 * La atomicidad "chat creado y luego falla el mensaje" no se puede provocar por
 * HTTP sin sabotear la base; esta ejercida en el VERIFY SQL de la migracion
 * (trigger temporal que revienta el INSERT: 0 chats despues).
 *
 * Sale con codigo 1 si algun caso no cumple lo esperado.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const cfg = (() => {
  if (process.env.VICINO_PRUEBAS_JSON) {
    const j = JSON.parse(fs.readFileSync(process.env.VICINO_PRUEBAS_JSON, "utf8"));
    return { url: j.url, anon: j.anon, productoId: j.productoId, vendedorId: j.users?.vendedor?.id ?? j.vendedorId };
  }
  const e = process.env;
  return { url: e.VICINO_PRUEBAS_URL, anon: e.VICINO_PRUEBAS_ANON_KEY, productoId: e.VICINO_PRUEBAS_PRODUCTO_ID, vendedorId: e.VICINO_PRUEBAS_VENDEDOR_ID };
})();
for (const k of ["url", "anon", "productoId", "vendedorId"]) if (!cfg[k]) { console.error(`falta ${k}`); process.exit(2); }
if (/oxxdkwywprkfghhbnoto/.test(cfg.url)) { console.error("Esto escribe de verdad: no se corre contra produccion."); process.exit(2); }

const headers = (token) => ({ apikey: cfg.anon, Authorization: `Bearer ${token ?? cfg.anon}`, "Content-Type": "application/json" });

/** Usuario nuevo por corrida: cuota limpia y sin chats previos. */
const usuarioNuevo = async (nombre) => {
  const email = `${nombre}.${crypto.randomUUID().slice(0, 8)}@pruebas-vicino.example.com`;
  const password = crypto.randomBytes(12).toString("base64url") + "Aa1!";
  const r = await fetch(`${cfg.url}/auth/v1/signup`, { method: "POST", headers: headers(null), body: JSON.stringify({ email, password, data: { full_name: `Prueba ${nombre}` } }) });
  const j = await r.json();
  if (!j.access_token) {
    console.error(`El signup de ${nombre} no devolvio sesion (${r.status} ${JSON.stringify(j).slice(0, 160)}). Activa la autoconfirmacion de correo en el entorno de pruebas.`);
    process.exit(2);
  }
  return { token: j.access_token, id: j.user.id, email };
};
const rpc = async (token, args) => {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/iniciar_conversacion`, { method: "POST", headers: headers(token), body: JSON.stringify(args) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};
const rest = async (token, path, init) => {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, { ...init, headers: { ...headers(token), Prefer: init?.prefer ?? "return=representation" } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};

let fallos = 0;
const check = (nombre, ok, detalle) => { console.log(`${ok ? "OK  " : "FAIL"} ${nombre}${detalle ? " -- " + detalle : ""}`); if (!ok) fallos++; };

const V = cfg.vendedorId;
const P = cfg.productoId;
const comprador = await usuarioNuevo("comprador");
const otro = await usuarioNuevo("otro");
const gloton = await usuarioNuevo("cuota");
console.log(`usuarios de esta corrida: ${comprador.email}, ${otro.email}, ${gloton.email}`);

// A. doble solicitud simultanea, misma clave
{
  const clave = crypto.randomUUID();
  const args = { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra", p_clave: clave };
  const [r1, r2] = await Promise.all([rpc(comprador.token, args), rpc(comprador.token, args)]);
  const ok = r1.status === 200 && r2.status === 200 && r1.body.chat_id === r2.body.chat_id && r1.body.message_id === r2.body.message_id;
  const nuevos = [r1.body, r2.body].filter((b) => b.mensaje_nuevo).length;
  const filas = await rest(comprador.token, `messages?select=id&clave_idempotencia=eq.${clave}`);
  check("A. doble simultanea: mismo chat y mismo mensaje", ok, `${r1.status}/${r2.status} chat ${String(r1.body.chat_id).slice(0, 8)} msg ${String(r1.body.message_id).slice(0, 8)}`);
  check("A. exactamente UNA de las dos creo el mensaje", nuevos === 1, `mensaje_nuevo en ${nuevos} respuestas`);
  check("A. una sola fila con esa clave", filas.body.length === 1, `${filas.body.length} filas`);

  // B. reintento con la misma clave
  const r3 = await rpc(comprador.token, args);
  check("B. reintento: repetida=true, mismo mensaje", r3.status === 200 && r3.body.repetida === true && r3.body.message_id === r1.body.message_id, JSON.stringify(r3.body));
  const filas2 = await rest(comprador.token, `messages?select=id&clave_idempotencia=eq.${clave}`);
  check("B. sigue habiendo una sola fila", filas2.body.length === 1);

  // C. operacion nueva
  const r4 = await rpc(comprador.token, { ...args, p_clave: crypto.randomUUID() });
  check("C. clave nueva: mensaje nuevo en el MISMO chat", r4.status === 200 && r4.body.mensaje_nuevo === true && r4.body.chat_id === r1.body.chat_id && r4.body.message_id !== r1.body.message_id, JSON.stringify(r4.body));
  const chats = await rest(comprador.token, `chats?select=id&comprador_id=eq.${comprador.id}&vendedor_id=eq.${V}`);
  check("C. un solo chat comprador-vendedor", chats.body.length === 1, `${chats.body.length} chats`);

  // D. no autorizado / mal uso
  const a = await rpc(null, { p_vendedor_id: V });
  check("D. anon: rechazado", a.status === 401 || a.status === 403 || a.body?.code === "42501", `${a.status} ${a.body?.code ?? ""}`);
  const b = await rpc(comprador.token, { p_vendedor_id: comprador.id });
  check("D. contigo mismo: 22023", b.body?.code === "22023", `${b.status} ${b.body?.code}`);
  const c = await rpc(comprador.token, { p_vendedor_id: otro.id, p_producto_id: P, p_intencion: "compra", p_clave: crypto.randomUUID() });
  check("D. producto que no es de ese vendedor: PT404", c.status === 404 && c.body?.code === "PT404", `${c.status} ${c.body?.code}`);
  const d = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra" });
  check("D. compra sin clave: 22023", d.body?.code === "22023", `${d.status} ${d.body?.code}`);
  const e = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "regalo" });
  check("D. intencion desconocida: 22023", e.body?.code === "22023", `${e.status} ${e.body?.code}`);
  const f = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: crypto.randomUUID(), p_intencion: "compra", p_clave: clave });
  check("D. misma clave con otro producto: PT409", f.status === 409 && f.body?.code === "PT409", `${f.status} ${f.body?.code}`);
  const g = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "contacto", p_clave: clave });
  check("D. contacto ignora la clave: message_id null, repetida false", g.status === 200 && g.body.message_id === null && g.body.repetida === false, JSON.stringify(g.body));
  const forja = await rest(comprador.token, "messages", { method: "POST", body: JSON.stringify({ chat_id: r1.body.chat_id, autor_id: comprador.id, texto: "aviso falso", message_type: "purchase_intent" }) });
  check("D. INSERT directo con message_type purchase_intent: 42501", forja.status === 403 || forja.body?.code === "42501", `${forja.status} ${forja.body?.code ?? ""}`);
  const forja2 = await rest(comprador.token, "messages", { method: "POST", body: JSON.stringify({ chat_id: r1.body.chat_id, autor_id: comprador.id, texto: "con clave", clave_idempotencia: crypto.randomUUID() }) });
  check("D. INSERT directo con clave_idempotencia: 42501", forja2.status === 403 || forja2.body?.code === "42501", `${forja2.status} ${forja2.body?.code ?? ""}`);
  const normal = await rest(comprador.token, "messages", { method: "POST", body: JSON.stringify({ chat_id: r1.body.chat_id, autor_id: comprador.id, texto: "hola, sigue disponible?" }) });
  check("D. INSERT directo de texto normal sigue entrando (sendMessage)", normal.status === 201, `${normal.status} ${normal.body?.code ?? ""}`);
}

// E. fallo sin rastro: 'otro' intenta comprar a 'vendedor' un producto inexistente -> PT404 y NO aparece chat
{
  const r = await rpc(otro.token, { p_vendedor_id: V, p_producto_id: crypto.randomUUID(), p_intencion: "compra", p_clave: crypto.randomUUID() });
  const despues = await rest(otro.token, `chats?select=id&comprador_id=eq.${otro.id}&vendedor_id=eq.${V}`);
  check("E. fallo (PT404) sin rastro: no aparece un chat", r.body?.code === "PT404" && despues.body.length === 0, `${r.status} ${r.body?.code}; chats despues ${despues.body.length}`);
}

// F. 10 claves distintas en paralelo (usuario 'otro', sin chat previo con V)
{
  const claves = Array.from({ length: 10 }, () => crypto.randomUUID());
  const rs = await Promise.all(claves.map((k) => rpc(otro.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra", p_clave: k })));
  const oks = rs.filter((r) => r.status === 200 && r.body.mensaje_nuevo === true).length;
  const chatsDistintos = new Set(rs.filter((r) => r.status === 200).map((r) => r.body.chat_id)).size;
  const nuevos = rs.filter((r) => r.status === 200 && r.body.chat_nuevo).length;
  check("F. 10 en paralelo con claves distintas: 10 mensajes nuevos", oks === 10, `${oks}/10 (estados ${rs.map((r) => r.status).join(",")}${rs.some((r) => r.body?.code) ? "; codigos " + rs.map((r) => r.body?.code ?? "-").join(",") : ""})`);
  check("F. todos en el mismo chat y exactamente uno lo creo", chatsDistintos === 1 && nuevos === 1, `${chatsDistintos} chats, chat_nuevo en ${nuevos}`);
  const msgs = await rest(otro.token, `messages?select=id,texto&chat_id=eq.${rs[0].body.chat_id}&clave_idempotencia=in.(${claves.join(",")})`);
  check("F. el vendedor recibio 10 avisos, ni uno mas", msgs.body.length === 10, `${msgs.body.length} filas; texto: ${msgs.body[0]?.texto}`);
}

// G. cuota: 30 en paralelo entran (la llave del actor las serializa), la 31.a da 23514 y no deja rastro
{
  const rs = await Promise.all(Array.from({ length: 30 }, () => rpc(gloton.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra", p_clave: crypto.randomUUID() })));
  const oks = rs.filter((r) => r.status === 200 && r.body.mensaje_nuevo).length;
  check("G. 30 intenciones en paralelo entran todas", oks === 30, `${oks}/30 (codigos: ${[...new Set(rs.map((r) => r.body?.code ?? r.status))].join(",")})`);
  const chatId = rs.find((r) => r.status === 200)?.body.chat_id;
  const antes = await rest(gloton.token, `chats?select=updated_at&id=eq.${chatId}`);
  const r31 = await rpc(gloton.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra", p_clave: crypto.randomUUID() });
  const despues = await rest(gloton.token, `chats?select=updated_at&id=eq.${chatId}`);
  check("G. la 31.a da 23514", r31.body?.code === "23514", `${r31.status} ${r31.body?.code}`);
  check("G. la 31.a no dejo rastro (updated_at intacto: el bump se deshizo)", antes.body[0]?.updated_at === despues.body[0]?.updated_at, `${antes.body[0]?.updated_at} -> ${despues.body[0]?.updated_at}`);
  const contacto = await rpc(gloton.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "contacto" });
  check("G. contacto sigue permitido con la cuota agotada", contacto.status === 200 && contacto.body.message_id === null, JSON.stringify(contacto.body));
}

console.log(fallos ? `\n${fallos} caso(s) fallaron` : "\nTodos los casos cumplen el contrato");
process.exit(fallos ? 1 : 0);
