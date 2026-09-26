#!/usr/bin/env node
/**
 * PT03 — contrato S04 (20260925010000) contra el STAGING, por HTTP real y con
 * peticiones CONCURRENTES (conexiones distintas de PostgREST: lo que PGlite no
 * puede probar). Crea usuarios nuevos en cada corrida y los retira al final.
 *
 *   node scripts/staging/probar-s04.mjs
 *
 * Sale con 1 si algun caso no cumple.
 */
import crypto from 'node:crypto';
import {
  staging, http, rpc, crearUsuario, crearProducto, bloquear, desbloquear, suspender, leer, limpiar,
} from './fixtures.mjs';

const cfg = staging();
const uuid = () => crypto.randomUUID();
const resultados = [];
const caso = async (nombre, fn) => {
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true, detalle });
    console.log(`  OK   ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  } catch (e) {
    resultados.push({ nombre, ok: false, detalle: e.message });
    console.log(`  FALLO ${nombre} — ${e.message}`);
  }
};
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };
const codigo = (r) => r.body?.code;
const esCodigo = (r, code) =>
  esperar(codigo(r) === code, `esperaba ${code}, llego HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const revision = async (token, chatId) => {
  const r = await http(cfg, 'GET', `/rest/v1/chats?id=eq.${chatId}&select=producto_revision,ultimo_producto_id`, { token });
  esperar(r.status === 200 && r.body.length === 1, `no pude leer el chat: ${r.status}`);
  return r.body[0];
};
const iniciar = (token, a) =>
  rpc(cfg, token, 'iniciar_confirmacion_venta', {
    p_chat_id: a.chat, p_producto_id: a.producto, p_revision_esperada: a.rev, p_clave: a.clave,
    p_precio: a.precio ?? 150, p_cantidad: a.cantidad ?? 1, p_metodo_pago: a.metodo ?? null,
    p_notas: a.notas ?? null, p_tipo_entrega: a.entrega ?? 'pickup',
  });
const seleccionar = (token, chat, producto, rev) =>
  rpc(cfg, token, 'seleccionar_producto_chat', { p_chat_id: chat, p_producto_id: producto, p_revision_esperada: rev });
const confirmar = (token, id) => rpc(cfg, token, 'confirmar_venta', { p_confirmacion_id: id });
const cuenta = async (query) => (await leer(cfg, query))[0].n;

const main = async () => {
  console.log(`Staging ${cfg.ref} — preparando fixtures...`);
  const V = await crearUsuario(cfg, 's04-vendedor');
  const C = await crearUsuario(cfg, 's04-comprador');
  const T = await crearUsuario(cfg, 's04-tercero');
  const P1 = await crearProducto(cfg, V.id, { titulo: 'P1 disponible' });
  const P2 = await crearProducto(cfg, V.id, { titulo: 'P2 disponible', precio: 99.5 });
  const P3 = await crearProducto(cfg, V.id, { titulo: 'P3 pausado', estatus: 'pausado' });
  const P4 = await crearProducto(cfg, V.id, { titulo: 'P4 eliminado', estatus: 'eliminado' });
  const P5 = await crearProducto(cfg, V.id, { titulo: 'P5 oculto', oculto: true });
  const PC = await crearProducto(cfg, C.id, { titulo: 'PC del comprador' });
  const PT = await crearProducto(cfg, T.id, { titulo: 'PT del tercero' });

  const chatR = await rpc(cfg, C.token, 'get_or_create_chat', { p_comprador_id: C.id, p_vendedor_id: V.id, p_producto_id: P1 });
  esperar(chatR.status === 200 && typeof chatR.body === 'string', `get_or_create_chat: ${chatR.status} ${JSON.stringify(chatR.body)}`);
  const chat = chatR.body;
  let rev;
  console.log('Fixtures listos. Casos:');

  // Cada bloque arranca desde el estado real del chat, para que un fallo no
  // arrastre a los siguientes con una revision vieja.
  const refrescar = async () => { rev = (await revision(C.token, chat)).producto_revision; };
  const asegurarProducto = async (p) => {
    await refrescar();
    const r = await seleccionar(V.token, chat, p, rev);
    if (r.status !== 200) throw new Error(`no pude fijar el producto del chat: ${JSON.stringify(r.body)}`);
    rev = r.body.revision;
  };

  // --- A. Seleccion de producto con CAS por revision -------------------------
  await caso('A1 el chat nace con el producto de origen y revision legible por ambos', async () => {
    const a = await revision(C.token, chat);
    const b = await revision(V.token, chat);
    esperar(a.ultimo_producto_id === P1 && b.producto_revision === a.producto_revision, JSON.stringify({ a, b }));
    rev = a.producto_revision;
    return `revision ${rev}`;
  });
  await caso('A2 el vendedor cambia a P2 con la revision vigente -> avanza 1', async () => {
    const r = await seleccionar(V.token, chat, P2, rev);
    esperar(r.status === 200 && r.body.revision === rev + 1 && r.body.product.id === P2, JSON.stringify(r.body));
    rev = r.body.revision;
    return `revision ${rev}`;
  });
  await caso('A3 el comprador con la revision vieja -> PT409 product_changed', async () => {
    const r = await seleccionar(C.token, chat, P1, rev - 1);
    esCodigo(r, 'PT409');
    esperar(r.body.hint === 'product_changed', `hint ${r.body.hint}`);
  });
  await caso('A4 A->B->A: el comprador vuelve a P1 con la revision vigente', async () => {
    const r = await seleccionar(C.token, chat, P1, rev);
    esperar(r.status === 200 && r.body.revision === rev + 1, JSON.stringify(r.body));
    rev = r.body.revision;
  });
  await caso('A5 elegir el MISMO producto no avanza la revision', async () => {
    const r = await seleccionar(V.token, chat, P1, rev);
    esperar(r.status === 200 && r.body.revision === rev, JSON.stringify(r.body));
  });
  await caso('A6 un tercero no puede seleccionar en el chat -> PT404', async () =>
    esCodigo(await seleccionar(T.token, chat, P1, rev), 'PT404'));
  for (const [nombre, p] of [['pausado', P3], ['eliminado', P4], ['oculto', P5], ['de un tercero', PT]]) {
    await caso(`A7 producto ${nombre} -> PT404`, async () => { await refrescar(); esCodigo(await seleccionar(C.token, chat, p, rev), 'PT404'); });
  }
  await caso('A8 escribir ultimo_producto_id directo por REST -> 42501', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/chats?id=eq.${chat}`, { token: C.token, body: { ultimo_producto_id: P2 } });
    esCodigo(r, '42501');
  });

  // --- B. Iniciar confirmacion ----------------------------------------------
  await asegurarProducto(P1);
  const clave1 = uuid();
  let venta1;
  await caso('B1 formulario obsoleto (revision vieja) -> PT409 product_changed', async () => {
    const r = await iniciar(C.token, { chat, producto: P1, rev: rev - 1, clave: uuid() });
    esCodigo(r, 'PT409');
  });
  await caso('B2 producto distinto al del chat -> PT409', async () =>
    esCodigo(await iniciar(C.token, { chat, producto: P2, rev, clave: uuid() }), 'PT409'));
  await caso('B3 datos invalidos (precio 0, cantidad 0, entrega rara) -> 22023', async () => {
    for (const extra of [{ precio: 0 }, { cantidad: 0 }, { entrega: 'dron' }, { precio: 10.001 }]) {
      esCodigo(await iniciar(C.token, { chat, producto: P1, rev, clave: uuid(), ...extra }), '22023');
    }
  });
  await caso('B4 doble envio SIMULTANEO con la misma clave -> 1 fila, 1 aviso', async () => {
    const [a, b] = await Promise.all([
      iniciar(C.token, { chat, producto: P1, rev, clave: clave1, precio: 150, cantidad: 2 }),
      iniciar(C.token, { chat, producto: P1, rev, clave: clave1, precio: 150, cantidad: 2 }),
    ]);
    esperar(a.status === 200 && b.status === 200, `${a.status}/${b.status} ${JSON.stringify(a.body).slice(0, 120)}`);
    esperar(a.body.confirmation.id === b.body.confirmation.id, 'ids distintos');
    esperar([a.body.repeated, b.body.repeated].sort().join() === 'false,true', 'repeated no fue false+true');
    venta1 = a.body.confirmation;
    const filas = await cuenta(`select count(*)::int n from sale_confirmations where chat_id = ${q(chat)}`);
    const avisos = await cuenta(`select count(*)::int n from messages where sale_confirmation_id = ${q(venta1.id)} and message_type = 'sale_proposed'`);
    esperar(filas === 1 && avisos === 1, `filas ${filas}, avisos ${avisos}`);
    esperar(venta1.buyer_id === C.id && venta1.seller_id === V.id && venta1.buyer_confirmed === true, 'roles o auto-confirmacion mal');
    return `venta ${venta1.id.slice(0, 8)}`;
  });
  await caso('B5 reintento (perdida de respuesta) -> repeated, sin filas nuevas', async () => {
    const r = await iniciar(C.token, { chat, producto: P1, rev, clave: clave1, precio: 150, cantidad: 2 });
    esperar(r.status === 200 && r.body.repeated === true && r.body.confirmation.id === venta1.id, JSON.stringify(r.body).slice(0, 160));
  });
  await caso('B6 misma clave con otro precio -> PT409 idempotency_conflict', async () => {
    const r = await iniciar(C.token, { chat, producto: P1, rev, clave: clave1, precio: 151, cantidad: 2 });
    esCodigo(r, 'PT409');
    esperar(r.body.hint === 'idempotency_conflict', `hint ${r.body.hint}`);
  });
  await caso('B7 clave nueva con una venta pendiente -> PT409 pending_confirmation', async () => {
    const r = await iniciar(V.token, { chat, producto: P1, rev, clave: uuid() });
    esCodigo(r, 'PT409');
    esperar(r.body.hint === 'pending_confirmation', `hint ${r.body.hint}`);
  });
  await caso('B8 un tercero no puede iniciar -> PT404', async () =>
    esCodigo(await iniciar(T.token, { chat, producto: P1, rev, clave: uuid() }), 'PT404'));
  await caso('B9 INSERT directo en sale_confirmations -> 42501', async () => {
    const r = await http(cfg, 'POST', '/rest/v1/sale_confirmations', {
      token: C.token,
      body: { chat_id: chat, product_id: P1, buyer_id: C.id, seller_id: V.id, initiated_by: C.id, precio_acordado: 1, cantidad: 1 },
    });
    esCodigo(r, '42501');
  });
  await caso('B10 marcar buyer/seller_confirmed directo -> 42501', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/sale_confirmations?id=eq.${venta1.id}`, { token: V.token, body: { seller_confirmed: true } });
    esCodigo(r, '42501');
  });

  // --- C. Confirmacion mutua atomica ----------------------------------------
  const antes = (await leer(cfg, `select (select trust_points from profiles where id=${q(V.id)}) tv, (select total_sales from profiles where id=${q(V.id)}) sv, (select trust_points from profiles where id=${q(C.id)}) tc, (select ventas_count from products_services where id=${q(P1)}) vc`))[0];
  await caso('C1 un tercero no puede confirmar -> PT404', async () => esCodigo(await confirmar(T.token, venta1.id), 'PT404'));
  await caso('C2 el vendedor confirma DOS veces a la vez -> completada una sola vez', async () => {
    const [a, b] = await Promise.all([confirmar(V.token, venta1.id), confirmar(V.token, venta1.id)]);
    esperar(a.status === 200 && b.status === 200, `${a.status}/${b.status} ${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`);
    esperar([a.body.alreadyConfirmed, b.body.alreadyConfirmed].sort().join() === 'false,true', 'alreadyConfirmed no fue false+true');
    const d = (await leer(cfg, `select (select status::text from sale_confirmations where id=${q(venta1.id)}) st, (select trust_points from profiles where id=${q(V.id)}) tv, (select total_sales from profiles where id=${q(V.id)}) sv, (select trust_points from profiles where id=${q(C.id)}) tc, (select ventas_count from products_services where id=${q(P1)}) vc, (select count(*)::int from messages where sale_confirmation_id=${q(venta1.id)} and message_type='sale_confirmed') msgs`))[0];
    esperar(d.st === 'completed', `estado ${d.st}`);
    esperar(d.tv - antes.tv === 10 && d.sv - antes.sv === 1 && d.tc - antes.tc === 3 && d.vc - antes.vc === 2,
      `puntos/ventas mal: ${JSON.stringify({ antes, d })}`);
    esperar(d.msgs === 1, `mensajes de venta confirmada: ${d.msgs}`);
    return 'puntos +10/+3, total_sales +1, ventas_count +2, 1 aviso';
  });
  await caso('C3 confirmar otra vez una venta completada -> alreadyConfirmed, nada nuevo', async () => {
    const r = await confirmar(C.token, venta1.id);
    esperar(r.status === 200 && r.body.alreadyConfirmed === true, JSON.stringify(r.body));
    const msgs = await cuenta(`select count(*)::int n from messages where sale_confirmation_id=${q(venta1.id)} and message_type='sale_confirmed'`);
    esperar(msgs === 1, `mensajes ${msgs}`);
  });

  // --- D. Cancelacion y guarda ----------------------------------------------
  let venta2;
  await asegurarProducto(P1);
  await caso('D1 nueva venta tras completar (la completada no bloquea)', async () => {
    const r = await iniciar(V.token, { chat, producto: P1, rev, clave: uuid(), precio: 120 });
    esperar(r.status === 200 && r.body.repeated === false, JSON.stringify(r.body).slice(0, 160));
    venta2 = r.body.confirmation;
    esperar(venta2.seller_confirmed === true && venta2.buyer_confirmed === false, 'auto-confirmacion del iniciador');
  });
  await caso('D2 un tercero no ve la venta para cancelarla (0 filas)', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/sale_confirmations?id=eq.${venta2.id}`, {
      token: T.token, body: { status: 'cancelled', cancelled_by: T.id }, prefer: 'return=representation',
    });
    esperar((r.status === 200 && Array.isArray(r.body) && r.body.length === 0) || codigo(r) === '42501', `${r.status} ${JSON.stringify(r.body)}`);
  });
  await caso('D3 cancelar a nombre del otro -> 42501', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/sale_confirmations?id=eq.${venta2.id}`, {
      token: C.token, body: { status: 'cancelled', cancelled_by: V.id, cancelled_at: new Date().toISOString() },
    });
    esCodigo(r, '42501');
  });
  await caso('D4 cancelar a nombre propio -> cancelada', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/sale_confirmations?id=eq.${venta2.id}`, {
      token: C.token, body: { status: 'cancelled', cancelled_by: C.id, cancelled_at: new Date().toISOString(), cancel_reason: 'prueba' },
      prefer: 'return=representation',
    });
    esperar(r.status === 200 && r.body[0]?.status === 'cancelled', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  });
  await caso('D5 reabrir una cancelada -> rechazado', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/sale_confirmations?id=eq.${venta2.id}`, { token: C.token, body: { status: 'pending_confirmation' } });
    esperar(['PT409', '42501'].includes(codigo(r)), `${r.status} ${JSON.stringify(r.body)}`);
  });

  // --- E. Roles invertidos (el producto es del comprador del chat) ----------
  await refrescar();
  await caso('E1 producto del comprador del chat: vende el comprador, compra el vendedor', async () => {
    const s = await seleccionar(C.token, chat, PC, rev);
    esperar(s.status === 200, `seleccionar PC: ${JSON.stringify(s.body)}`);
    rev = s.body.revision;
    const r = await iniciar(V.token, { chat, producto: PC, rev, clave: uuid(), precio: 80 });
    esperar(r.status === 200, JSON.stringify(r.body).slice(0, 160));
    const v = r.body.confirmation;
    esperar(v.buyer_id === V.id && v.seller_id === C.id && v.buyer_confirmed === true, JSON.stringify(v));
    const c = await confirmar(C.token, v.id);
    esperar(c.status === 200 && c.body.alreadyConfirmed === false, JSON.stringify(c.body));
    const [st] = await leer(cfg, `select status::text from sale_confirmations where id = ${q(v.id)}`);
    esperar(st.status === 'completed', `estado ${st.status}`);
  });

  // --- F. Bloqueo y suspension -----------------------------------------------
  await refrescar();
  await caso('F1 con bloqueo en cualquier sentido -> PT404 al seleccionar e iniciar', async () => {
    await bloquear(cfg, V.id, C.id);
    try {
      esCodigo(await seleccionar(C.token, chat, P1, rev), 'PT404');
      esCodigo(await iniciar(C.token, { chat, producto: PC, rev, clave: uuid() }), 'PT404');
    } finally {
      await desbloquear(cfg, V.id, C.id);
    }
  });
  let venta3;
  await caso('F2 cuenta suspendida: no selecciona ni inicia (42501) pero SI confirma un trato previo', async () => {
    const r = await iniciar(C.token, { chat, producto: PC, rev, clave: uuid(), precio: 60 });
    esperar(r.status === 200, `preparar venta: ${JSON.stringify(r.body).slice(0, 120)}`);
    venta3 = r.body.confirmation;
    await suspender(cfg, V.id, true);
    try {
      esCodigo(await seleccionar(V.token, chat, P1, rev), '42501');
      esCodigo(await iniciar(V.token, { chat, producto: PC, rev, clave: uuid() }), '42501');
      const c = await confirmar(V.token, venta3.id);
      esperar(c.status === 200 && c.body.success === true, `confirmar suspendido: ${JSON.stringify(c.body)}`);
    } finally {
      await suspender(cfg, V.id, false);
    }
  });

  // --- G. El chat sigue funcionando tras cerrar las escrituras directas ------
  await caso('G1 mandar mensaje de texto -> 201 y sube el no-leido del otro', async () => {
    const [a] = await leer(cfg, `select no_leidos_vendedor n from chats where id = ${q(chat)}`);
    const r = await http(cfg, 'POST', '/rest/v1/messages', {
      token: C.token, body: { chat_id: chat, autor_id: C.id, texto: 'hola desde la prueba', message_type: 'user_text' },
    });
    esperar(r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
    const [b] = await leer(cfg, `select no_leidos_vendedor n from chats where id = ${q(chat)}`);
    esperar(b.n === a.n + 1, `no_leidos ${a.n} -> ${b.n}`);
  });
  await caso('G2 ocultar el chat (oculto_para_*/deleted_at_*) sigue permitido', async () => {
    const r = await http(cfg, 'PATCH', `/rest/v1/chats?id=eq.${chat}`, {
      token: C.token, body: { oculto_para_comprador: true, deleted_at_comprador: new Date().toISOString() }, prefer: 'return=representation',
    });
    esperar(r.status === 200 && r.body[0]?.oculto_para_comprador === true, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  });
  await caso('G3 forjar un aviso de venta como mensaje -> rechazado', async () => {
    const r = await http(cfg, 'POST', '/rest/v1/messages', {
      token: C.token, body: { chat_id: chat, autor_id: C.id, texto: 'venta falsa', message_type: 'sale_confirmed', sale_confirmation_id: venta1.id },
    });
    esperar(r.status >= 400, `${r.status} ${JSON.stringify(r.body)}`);
  });

  // --- Limpieza ----------------------------------------------------------------
  const quedan = await limpiar(cfg);
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\nResultado: ${resultados.length - fallos.length}/${resultados.length} casos OK. Fixtures restantes: ${quedan}.`);
  process.exit(fallos.length ? 1 : 0);
};

main().catch(async (e) => {
  console.error(`ERROR: ${e.message}`);
  try { await limpiar(cfg); } catch {}
  process.exit(2);
});
