#!/usr/bin/env node
/**
 * Pruebas por HTTP del contrato iniciar_conversacion (20260912300000), con
 * peticiones REALES y CONCURRENTES contra un Supabase de pruebas (local con
 * `supabase start`, o un proyecto de pruebas). NUNCA contra produccion: cada
 * caso escribe chats y mensajes de verdad.
 *
 *   VICINO_PRUEBAS_JSON=/ruta/pruebas-auth.json node scripts/probar-iniciar-conversacion.mjs
 *
 * o por variables sueltas:
 *   VICINO_PRUEBAS_URL, VICINO_PRUEBAS_ANON_KEY,
 *   VICINO_PRUEBAS_COMPRADOR_EMAIL / _PASSWORD,
 *   VICINO_PRUEBAS_VENDEDOR_EMAIL / _PASSWORD / _ID,
 *   VICINO_PRUEBAS_OTRO_EMAIL / _PASSWORD,
 *   VICINO_PRUEBAS_PRODUCTO_ID   (producto disponible del vendedor)
 *
 * Casos (lo que pidio Alejandro el 6-sep):
 *   A. doble solicitud SIMULTANEA con la misma clave  -> mismo chat, mismo mensaje, 1 fila
 *   B. reintento con la misma clave                  -> repetida, sin filas nuevas
 *   C. operacion nueva (clave nueva)                 -> mensaje nuevo en el mismo chat
 *   D. usuario no autorizado                         -> anon 401; contigo mismo 22023;
 *                                                       producto ajeno PT404; compra sin clave 22023
 *   E. fallo parcial                                 -> la llamada falla y NO queda chat
 *   F. 10 claves distintas en paralelo               -> 10 mensajes, 1 chat
 *
 * Sale con codigo 1 si algun caso no cumple lo esperado.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const cfg = (() => {
  if (process.env.VICINO_PRUEBAS_JSON) {
    const j = JSON.parse(fs.readFileSync(process.env.VICINO_PRUEBAS_JSON, "utf8"));
    return {
      url: j.url, anon: j.anon, productoId: j.productoId,
      comprador: j.users.comprador, vendedor: j.users.vendedor, otro: j.users.otro,
    };
  }
  const e = process.env;
  return {
    url: e.VICINO_PRUEBAS_URL, anon: e.VICINO_PRUEBAS_ANON_KEY, productoId: e.VICINO_PRUEBAS_PRODUCTO_ID,
    comprador: { email: e.VICINO_PRUEBAS_COMPRADOR_EMAIL, password: e.VICINO_PRUEBAS_COMPRADOR_PASSWORD },
    vendedor: { email: e.VICINO_PRUEBAS_VENDEDOR_EMAIL, password: e.VICINO_PRUEBAS_VENDEDOR_PASSWORD, id: e.VICINO_PRUEBAS_VENDEDOR_ID },
    otro: { email: e.VICINO_PRUEBAS_OTRO_EMAIL, password: e.VICINO_PRUEBAS_OTRO_PASSWORD },
  };
})();
for (const k of ["url", "anon", "productoId"]) if (!cfg[k]) { console.error(`falta ${k}`); process.exit(2); }
if (/oxxdkwywprkfghhbnoto/.test(cfg.url)) { console.error("Esto escribe de verdad: no se corre contra produccion."); process.exit(2); }

const login = async (u) => {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: cfg.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login fallo para ${u.email}: ${r.status} ${JSON.stringify(j).slice(0, 150)}`);
  return { token: j.access_token, id: j.user.id };
};
const rpc = async (token, args) => {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/iniciar_conversacion`, {
    method: "POST",
    headers: { apikey: cfg.anon, Authorization: `Bearer ${token ?? cfg.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};
const rest = async (token, path) => {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${token}`, Prefer: "count=exact" } });
  return { status: r.status, body: await r.json(), count: r.headers.get("content-range") };
};

let fallos = 0;
const check = (nombre, ok, detalle) => { console.log(`${ok ? "OK  " : "FAIL"} ${nombre}${detalle ? " -- " + detalle : ""}`); if (!ok) fallos++; };

const comprador = await login(cfg.comprador);
const vendedor = await login(cfg.vendedor);
const otro = await login(cfg.otro);
const V = cfg.vendedor.id ?? vendedor.id;
const P = cfg.productoId;

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
  const chats = await rest(comprador.token, `chats?select=id&or=(comprador_id.eq.${comprador.id},vendedor_id.eq.${comprador.id})&vendedor_id=eq.${V}`);
  check("C. un solo chat comprador-vendedor", chats.body.length === 1, `${chats.body.length} chats`);
}

// D. no autorizado
{
  const a = await rpc(null, { p_vendedor_id: V });
  check("D. anon: rechazado", a.status === 401 || a.status === 403 || a.body?.code === "42501", `${a.status} ${a.body?.code ?? ""}`);
  const b = await rpc(comprador.token, { p_vendedor_id: comprador.id });
  check("D. contigo mismo: 22023", b.body?.code === "22023", `${b.status} ${b.body?.code}`);
  const c = await rpc(comprador.token, { p_vendedor_id: otro.id, p_producto_id: P, p_intencion: "compra", p_clave: crypto.randomUUID() });
  check("D. producto que no es de ese vendedor: PT404", c.body?.code === "PT404", `${c.status} ${c.body?.code}`);
  const d = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra" });
  check("D. compra sin clave: 22023", d.body?.code === "22023", `${d.status} ${d.body?.code}`);
  const e = await rpc(comprador.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "regalo" });
  check("D. intencion desconocida: 22023", e.body?.code === "22023", `${e.status} ${e.body?.code}`);
}

// E. fallo parcial: 'otro' intenta comprar a 'vendedor' un producto inexistente -> PT404 y NO queda chat
{
  const antes = await rest(otro.token, `chats?select=id&comprador_id=eq.${otro.id}&vendedor_id=eq.${V}`);
  const r = await rpc(otro.token, { p_vendedor_id: V, p_producto_id: crypto.randomUUID(), p_intencion: "compra", p_clave: crypto.randomUUID() });
  const despues = await rest(otro.token, `chats?select=id&comprador_id=eq.${otro.id}&vendedor_id=eq.${V}`);
  check("E. fallo (PT404) sin estado parcial: no aparece un chat nuevo", r.body?.code === "PT404" && despues.body.length === antes.body.length, `${r.status} ${r.body?.code}; chats antes ${antes.body.length} despues ${despues.body.length}`);
}

// F. 10 claves distintas en paralelo
{
  const claves = Array.from({ length: 10 }, () => crypto.randomUUID());
  const rs = await Promise.all(claves.map((k) => rpc(otro.token, { p_vendedor_id: V, p_producto_id: P, p_intencion: "compra", p_clave: k })));
  const oks = rs.filter((r) => r.status === 200 && r.body.mensaje_nuevo === true).length;
  const chatsDistintos = new Set(rs.filter((r) => r.status === 200).map((r) => r.body.chat_id)).size;
  const nuevos = rs.filter((r) => r.status === 200 && r.body.chat_nuevo).length;
  check("F. 10 en paralelo con claves distintas: 10 mensajes nuevos", oks === 10, `${oks}/10 (estados ${rs.map((r) => r.status).join(",")})`);
  check("F. todos en el mismo chat y solo uno lo creo", chatsDistintos === 1 && nuevos <= 1, `${chatsDistintos} chats, chat_nuevo en ${nuevos}`);
  const msgs = await rest(otro.token, `messages?select=id,texto&chat_id=eq.${rs[0].body.chat_id}&clave_idempotencia=in.(${claves.join(",")})`);
  check("F. el vendedor recibio 10 avisos, ni uno mas", msgs.body.length === 10, `${msgs.body.length} filas; texto: ${msgs.body[0]?.texto}`);
}

console.log(fallos ? `\n${fallos} caso(s) fallaron` : "\nTodos los casos cumplen el contrato");
process.exit(fallos ? 1 : 0);
