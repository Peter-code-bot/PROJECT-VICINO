import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { CanalesGestionados } from '../apps/web/lib/realtime/canales-gestionados';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { RealtimeClient } = require('@supabase/supabase-js') as typeof import('../apps/web/node_modules/@supabase/supabase-js');

test('SDK Realtime 2.99.3: cuatro canales, 30 ciclos, todos vuelven a SUBSCRIBED', async () => {
  let joins = 0;
  let framesAfterClose = 0;
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw: string) {
      if (this.readyState === 3) framesAfterClose++;
      const request = JSON.parse(raw) as { topic: string; event: string; ref: string; payload: { config?: { postgres_changes: object[] } } };
      if (request.event === 'phx_join') {
        joins++;
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ topic: request.topic, event: 'phx_reply', ref: request.ref,
          payload: { status: 'ok', response: { postgres_changes: (request.payload.config?.postgres_changes ?? []).map((binding, id) => ({ ...binding, id })) } } }) }));
      }
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code: 1000 })); }
  }
  const realtime = new RealtimeClient('wss://synthetic.invalid/realtime/v1', {
    params: { apikey: 'synthetic' }, transport: FakeSocket as unknown as typeof WebSocket,
    vsn: '1.0.0',
  });
  const controller = new CanalesGestionados({ realtime, getChannels: () => realtime.getChannels(), removeChannel: (channel) => realtime.removeChannel(channel) } as ConstructorParameters<typeof CanalesGestionados>[0]);
  let subscribed = 0;
  let cycleStart: number | undefined;
  const recoveryMs: number[] = [];
  const remove = Array.from({ length: 4 }, (_, i) => controller.registrar(`synthetic-${i}`, ({ vigente }) => realtime.channel(`synthetic-${i}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {})
    .subscribe((status) => {
      if (!vigente() || status !== 'SUBSCRIBED') return;
      subscribed++;
      if (cycleStart !== undefined && subscribed % 4 === 0) {
        recoveryMs.push(performance.now() - cycleStart);
        cycleStart = undefined;
      }
    })));
  try {
    await delay(25);
    assert.equal(subscribed, 4);
    for (let i = 0; i < 30; i++) {
      controller.confirmarEstado(false); await delay(120);
      assert.equal(realtime.getChannels().length, 0);
      assert.ok(sockets.every((socket) => socket.readyState === 3));
      cycleStart = performance.now();
      controller.confirmarEstado(true); await delay(25);
      assert.equal(realtime.getChannels().length, 4);
      assert.equal(subscribed, (i + 2) * 4);
    }
    const sorted = [...recoveryMs].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    assert.equal(recoveryMs.length, 30);
    assert.ok(p95 < 3_000);
    console.info(`recovery p95=${p95.toFixed(2)}ms; success=${recoveryMs.length}/30`);
    assert.equal(joins, 124);
    assert.equal(framesAfterClose, 0);
  } finally {
    remove.forEach((fn) => fn()); await delay(120); realtime.disconnect();
  }
});
