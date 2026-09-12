import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { reconciliarChat, fusionarMensajes, comparar, ultimoConfirmado, type Mensaje } from '../apps/web/lib/realtime/reconciliar-chat';
import type { Database } from '../apps/web/types/database.types';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js') as typeof import('../apps/web/node_modules/@supabase/supabase-js');
const time = '2026-09-01T10:00:00.123456Z';
const message = (n: number, own = false): Mensaje => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, chat_id: 'chat', autor_id: own ? 'user' : 'other', texto: 'same', attachments: [],
  created_at: time, leido_por_comprador: false, leido_por_vendedor: false,
});
function fixture(rows: Mensaje[], cutoff: string | null = null) {
  const queries: URL[] = [];
  let fail = false;
  let denied = false;
  const client = createClient<Database>('https://synthetic.invalid', 'synthetic-key', { accessToken: async () => 'synthetic', global: {
    fetch: async (input) => {
      const url = new URL(String(input)); queries.push(url);
      if (fail) return new Response('{"message":"synthetic"}', { status: 500 });
      const table = url.pathname.split('/').at(-1);
      if (table === 'chats') return Response.json(denied ? null : { comprador_id: 'user', vendedor_id: 'other', deleted_at_comprador: cutoff, deleted_at_vendedor: null });
      if (table === 'sale_confirmations') return Response.json([]);
      assert.equal(table, 'messages');
      let data = [...rows];
      for (const filter of url.searchParams.getAll('created_at')) {
        const dot = filter.indexOf('.'), op = filter.slice(0, dot), value = filter.slice(dot + 1);
        data = data.filter((m) => m.created_at && (op === 'gte' ? m.created_at >= value : op === 'lte' ? m.created_at <= value : m.created_at > value));
      }
      const or = url.searchParams.get('or');
      if (or) {
        const date = /created_at\.gt\.([^,]+)/.exec(or)![1];
        const id = /id\.gt\.([^)]*)/.exec(or)![1];
        data = data.filter((m) => m.created_at! > date || (m.created_at === date && m.id > id));
      }
      const ids = url.searchParams.get('id');
      if (ids) { const selected = ids.slice(4, -1).split(','); data = data.filter((m) => selected.includes(m.id)); }
      const desc = url.searchParams.get('order')?.startsWith('created_at.desc');
      data.sort((a, b) => (desc ? -1 : 1) * comparar({ ...a, created_at: a.created_at! }, { ...b, created_at: b.created_at! }));
      const limit = url.searchParams.get('limit');
      if (limit) data = data.slice(0, Number(limit));
      return Response.json(data);
    },
  } });
  return { client, queries, fail: () => { fail = true; }, deny: () => { denied = true; } };
}
const args = { chatId: 'chat', userId: 'user', deletedAt: null, loadedIds: [], cursor: null, intervalo: null };

test('chat vacio, primer mensaje y propios de otro dispositivo', async () => {
  const rows: Mensaje[] = [];
  const f = fixture(rows);
  const empty = await reconciliarChat(f.client, args);
  assert.equal(empty.denied, false);
  if (empty.denied) return;
  assert.deepEqual(empty.messages, []);
  rows.push(message(1), message(2, true), message(3, true));
  const result = await reconciliarChat(f.client, args);
  assert.equal(result.denied, false);
  if (result.denied) return;
  assert.equal(result.messages.length, 3);
  assert.equal(result.intervalo, null);
  assert.equal(result.messages.filter((m) => m.autor_id === 'user').length, 2);
});

test('1205 mensajes mismo timestamp: diez paginas, cursor pendiente y continuacion sin perdida', async () => {
  const rows = Array.from({ length: 1205 }, (_, n) => message(n + 1));
  const f = fixture(rows);
  const first = await reconciliarChat(f.client, args);
  assert.equal(first.denied, false);
  if (first.denied) return;
  assert.ok(first.intervalo);
  assert.equal(first.cursor, null);
  assert.equal(first.messages.length, 1050); // 1000 del intervalo + snapshot 50.
  rows.push({ ...message(1206), created_at: '2026-09-01T10:01:00.000000Z' });
  const second = await reconciliarChat(f.client, { ...args, intervalo: first.intervalo, loadedIds: first.messages.map((m) => m.id) });
  if (second.denied) assert.fail('denied');
  assert.equal(second.intervalo, null);
  assert.equal(second.cursor?.id, message(1205).id); // extremo congelado
  const merged = fusionarMensajes(first.messages, second.messages, new Map(), null);
  assert.equal(merged.length, 1206);
  assert.equal(new Set(merged.map((m) => m.id)).size, 1206);
  assert.ok(f.queries.filter((q) => q.searchParams.has('id')).every((q) => q.searchParams.get('id')!.split(',').length <= 100));
});

test('corte deletedAt, acuses de pagina antigua y proteccion de updates vivos', async () => {
  const older = { ...message(1), created_at: '2026-08-01T00:00:00Z', leido_por_comprador: true };
  const f = fixture([older, message(2), message(3)]);
  const result = await reconciliarChat(f.client, { ...args, loadedIds: [older.id], cursor: ultimoConfirmado([message(2)]) });
  if (result.denied) assert.fail('denied');
  assert.equal(result.messages.find((m) => m.id === older.id)?.leido_por_comprador, true);
  const live = { ...message(2), leido_por_comprador: true };
  const merged = fusionarMensajes([older], result.messages, new Map([[live.id, live]]), '2026-08-15T00:00:00Z');
  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.id === live.id)?.leido_por_comprador, true);
  const cut = await reconciliarChat(fixture([older, message(2)], '2026-08-15T00:00:00Z').client, args);
  if (cut.denied) assert.fail('denied');
  assert.equal(cut.messages.length, 1);
});

test('error no devuelve exito vacio; autorizacion ausente se distingue', async () => {
  const f = fixture([message(1)]);
  f.fail();
  await assert.rejects(reconciliarChat(f.client, args), /VICINO_CHAT_RECOVERY_PENDING/);
  const denied = fixture([]); denied.deny();
  assert.deepEqual(await reconciliarChat(denied.client, args), { denied: true });
});

test('cursor ignora temporales; precision submilisegundo y zonas UTC', () => {
  assert.equal(ultimoConfirmado([{ ...message(1), id: 'temp-1' }]), null);
  assert.equal(comparar({ id: 'a', created_at: '2026-09-01T10:00:00.123456Z' }, { id: 'a', created_at: '2026-09-01T10:00:00.123456+00:00' }), 0);
  assert.ok(comparar({ id: 'z', created_at: '2026-09-01T10:00:00.123455Z' }, { id: 'a', created_at: time }) < 0);
});
