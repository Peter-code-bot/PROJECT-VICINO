import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { instalarPausa } from '../apps/web/lib/realtime/pausa-en-segundo-plano';
import type { CanalesGestionados } from '../apps/web/lib/realtime/canales-gestionados';
type App = Awaited<Parameters<typeof instalarPausa>[0]>["app"];

test('listener primero, getState tardio no pisa appStateChange', async () => {
  let event!: (state: { isActive: boolean }) => void;
  let initial!: (state: { isActive: boolean }) => void;
  let removed = 0;
  const states: boolean[] = [];
  const controller = { esperarEstadoNativo: () => {}, confirmarEstado: (state: boolean) => states.push(state), deshabilitarPausa: () => assert.fail('unexpected') } as unknown as CanalesGestionados;
  const app = { addListener: async (_name: string, callback: typeof event) => { event = callback; return { remove: async () => { removed++; } }; },
    getState: () => { assert.ok(event); return new Promise<{ isActive: boolean }>((resolve) => { initial = resolve; }); },
  } as unknown as App;
  const handle = instalarPausa(Promise.resolve({ app }), controller);
  await nextTurn(); event({ isActive: false }); initial({ isActive: true }); await nextTurn();
  assert.deepEqual(states, [false]);
  await handle.remove(); event({ isActive: true }); assert.deepEqual(states, [false]);
  assert.equal(removed, 1);
});

test('cleanup retira handle que resuelve despues del desmontaje', async () => {
  let finish!: (handle: { remove: () => Promise<void> }) => void;
  let removed = 0;
  const app = { addListener: () => new Promise((r) => { finish = r; }), getState: () => assert.fail('unmounted') } as unknown as App;
  const controller = { esperarEstadoNativo: () => {}, deshabilitarPausa: () => assert.fail('unexpected') } as unknown as CanalesGestionados;
  const handle = instalarPausa(Promise.resolve({ app }), controller);
  await nextTurn(); await handle.remove();
  finish({ remove: async () => { removed++; } }); await nextTurn();
  assert.equal(removed, 1);
});

test('fallo de import/puente deshabilita pausa sin rechazo no capturado', async () => {
  let failed = 0;
  const controller = { esperarEstadoNativo: () => {}, deshabilitarPausa: () => { failed++; } } as unknown as CanalesGestionados;
  const handle = instalarPausa(Promise.reject(new Error('synthetic')), controller);
  await nextTurn(); assert.equal(failed, 1); await handle.remove();
});

test('un plugin thenable (proxy de Capacitor) instala igual y no cuelga', async () => {
  // Reproduce CAPACITOR-5: los plugins de Capacitor son Proxy y convierten
  // CUALQUIER propiedad desconocida en una llamada nativa, `then` incluido.
  // Si el plugin viajase como valor de resolucion, el motor de promesas
  // llamaria a `App.then(resolve, reject)`, iOS contestaria
  // `"App.then()" is not implemented on ios` y la promesa quedaria pendiente
  // para siempre: ni confirmarEstado ni deshabilitarPausa llegarian a correr.
  // Al ir envuelto en { app }, el valor de resolucion es un objeto plano.
  let removed = 0;
  const states: boolean[] = [];
  const real: Record<string, unknown> = {
    addListener: async () => ({ remove: async () => { removed++; } }),
    getState: async () => ({ isActive: true }),
  };
  const app = new Proxy(real, {
    get: (target, prop) =>
      prop in target
        ? target[prop as string]
        : () => Promise.reject(new Error(`"App.${String(prop)}()" is not implemented on ios`)),
  }) as unknown as App;
  const controller = { esperarEstadoNativo: () => {}, confirmarEstado: (s: boolean) => states.push(s), deshabilitarPausa: () => assert.fail('no deberia deshabilitarse') } as unknown as CanalesGestionados;
  const handle = instalarPausa(Promise.resolve({ app }), controller);
  await nextTurn(); await nextTurn();
  assert.deepEqual(states, [true]);
  await handle.remove();
  assert.equal(removed, 1);
});
