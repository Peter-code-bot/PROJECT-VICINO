import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CanalesGestionados, refrescoCoalescido } from '../apps/web/lib/realtime/canales-gestionados';
import type { RealtimeChannel } from '../apps/web/node_modules/@supabase/supabase-js';

function fixture(native = false) {
  const channels: RealtimeChannel[] = [];
  let disconnected = 0;
  let close: (() => Promise<void>) | null = null;
  const client = {
    getChannels: () => channels,
    removeChannel: async (c: RealtimeChannel) => { if (close) await close(); channels.splice(channels.indexOf(c), 1); return 'ok'; },
    realtime: { disconnect: () => { assert.equal(channels.length, 0); disconnected++; } },
  };
  const controller = new CanalesGestionados(client as unknown as ConstructorParameters<typeof CanalesGestionados>[0], native);
  const callbacks: Array<() => boolean> = [];
  let created = 0;
  const register = () => controller.registrar('synthetic', (scope) => {
    assert.equal(channels.length, 0);
    const channel = { topic: 'realtime:synthetic' } as RealtimeChannel;
    channels.push(channel); callbacks.push(scope.vigente); created++;
    return channel;
  });
  return { controller, channels, callbacks, register, created: () => created, disconnected: () => disconnected, delayClose: (fn: () => Promise<void>) => { close = fn; } };
}

test('30 ciclos, objetos nuevos, callbacks invalidados y StrictMode', async () => {
  const f = fixture();
  const remove = f.register();
  await nextTurn();
  for (let i = 0; i < 30; i++) {
    const old = f.callbacks.at(-1)!;
    f.controller.confirmarEstado(false);
    assert.equal(old(), false);
    await nextTurn();
    assert.equal(f.channels.length, 0);
    f.controller.confirmarEstado(true);
    await nextTurn();
    assert.equal(f.channels.length, 1);
    assert.equal(old(), false);
    assert.equal(f.callbacks.at(-1)!(), true);
  }
  assert.equal(f.created(), 31);
  remove(); remove();
  const removeNext = f.register();
  await nextTurn();
  assert.equal(f.channels.length, 1);
  removeNext();
  await nextTurn();
  assert.equal(f.channels.length, 0);
  assert.ok(f.disconnected() >= 30);
});

test('false/true/false durante cierre lento: prevalece ultimo estado', async () => {
  const f = fixture();
  let release!: () => void;
  f.delayClose(() => new Promise<void>((r) => { release = r; }));
  const remove = f.register();
  await nextTurn();
  f.controller.confirmarEstado(false);
  await nextTurn();
  f.controller.confirmarEstado(true);
  f.controller.confirmarEstado(false);
  release();
  await nextTurn();
  assert.equal(f.channels.length, 0);
  assert.equal(f.created(), 1);
  remove();
});

test('cierre sin confirmar no crea mismo topic; recupera tras cierre tardio', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let release!: () => void;
  f.delayClose(() => new Promise<void>((r) => { release = r; }));
  const remove = f.register();
  await nextTurn();
  f.controller.confirmarEstado(false);
  await nextTurn();
  f.controller.confirmarEstado(true);
  t.mock.timers.tick(2_000);
  await nextTurn();
  assert.equal(f.created(), 1);
  assert.equal(f.channels.length, 1);
  release();
  await nextTurn();
  assert.equal(f.created(), 2);
  f.delayClose(async () => {});
  remove();
  await nextTurn();
});

test('inicio nativo bloquea registro; fallo puente libera a los 2s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(true);
  const remove = f.register();
  await nextTurn();
  assert.equal(f.created(), 0);
  t.mock.timers.tick(2_000);
  await nextTurn();
  assert.equal(f.created(), 1);
  assert.equal(f.controller.pausaDeshabilitada, true);
  f.controller.confirmarEstado(false);
  assert.equal(f.channels.length, 1);
  remove(); await nextTurn();
});

test('una factory que falla retira el canal sin bucle y recupera en otro foreground', async () => {
  const channels: RealtimeChannel[] = [];
  const client = {
    getChannels: () => channels,
    removeChannel: async (channel: RealtimeChannel) => {
      channels.splice(channels.indexOf(channel), 1);
      return 'ok';
    },
    realtime: { disconnect: () => {} },
  };
  const controller = new CanalesGestionados(client as unknown as ConstructorParameters<typeof CanalesGestionados>[0]);
  let attempts = 0;
  const unregister = controller.registrar('synthetic-factory', () => {
    attempts++;
    const channel = { topic: 'realtime:synthetic-factory' } as RealtimeChannel;
    channels.push(channel);
    if (attempts === 1) throw new Error('synthetic');
    return channel;
  });
  await nextTurn();
  await nextTurn();
  assert.equal(attempts, 1);
  assert.equal(channels.length, 0);
  controller.confirmarEstado(false);
  controller.confirmarEstado(true);
  await nextTurn();
  assert.equal(attempts, 2);
  assert.equal(channels.length, 1);
  unregister();
  await nextTurn();
});

test('rafaga coalescida, sin consultas concurrentes ni polling', async () => {
  let calls = 0;
  let release!: () => void;
  const refresh = refrescoCoalescido(async () => { calls++; await new Promise<void>((r) => { release = r; }); }, () => assert.fail('unexpected'));
  for (let i = 0; i < 100; i++) refresh.solicitar();
  assert.equal(calls, 1);
  release(); await nextTurn();
  assert.equal(calls, 2);
  for (let i = 0; i < 100; i++) refresh.solicitar();
  release(); await nextTurn();
  assert.equal(calls, 2);
  refresh.cancelar(); refresh.solicitar();
  assert.equal(calls, 2);
});
