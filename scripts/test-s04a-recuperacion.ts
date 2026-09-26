import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recuperacionConexion } from '../apps/web/lib/realtime/recuperacion-conexion';

function fixture() {
  let reconnect = 0, reads = 0, pending = 0, available = true;
  const connection = recuperacionConexion({
    reconectar: () => { reconnect++; }, recuperar: () => { reads++; },
    pendiente: () => { pending++; }, disponible: () => available,
  });
  return { connection, reconnect: () => reconnect, reads: () => reads,
    pending: () => pending, available: (value: boolean) => { available = value; } };
}

test('SUBSCRIBED solicita una lectura; reintentar cerrado reconstruye transporte', () => {
  const f = fixture(); f.connection.esperando(); f.connection.estado('SUBSCRIBED');
  assert.equal(f.reads(), 1);
  f.connection.confirmada(); f.connection.reintentar(); assert.equal(f.reads(), 2);
  f.connection.estado('CLOSED'); f.connection.reintentar();
  assert.equal(f.reconnect(), 1); assert.equal(f.reads(), 2);
  f.connection.cancelar();
});

test('fallos persistentes agotan tres reintentos; manual renueva el presupuesto', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  for (const delay of [1000, 3000, 10000]) {
    f.connection.estado('TIMED_OUT'); t.mock.timers.tick(delay);
  }
  assert.equal(f.reconnect(), 3);
  f.connection.estado('CHANNEL_ERROR'); t.mock.timers.tick(60000);
  assert.equal(f.reconnect(), 3);
  f.connection.reintentar(); assert.equal(f.reconnect(), 4);
  f.connection.estado('CLOSED'); t.mock.timers.tick(1000); assert.equal(f.reconnect(), 5);
  f.connection.cancelar();
});

test('conexion sin estado vence; SUBSCRIBED no borra fallos de consulta', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.connection.esperando(); t.mock.timers.tick(15000);
  assert.equal(f.reconnect(), 1);
  f.connection.estado('SUBSCRIBED');
  f.connection.falloConsulta(); t.mock.timers.tick(3000);
  assert.equal(f.reads(), 2);
  f.connection.falloConsulta(); t.mock.timers.tick(10000);
  f.connection.estado('SUBSCRIBED'); f.connection.falloConsulta(); t.mock.timers.tick(60000);
  assert.equal(f.reads(), 4);
  f.connection.confirmada(); f.connection.falloConsulta(); t.mock.timers.tick(1000);
  assert.equal(f.reads(), 5);
  f.connection.cancelar();
});

test('offline, pausa y desmontaje no consultan ni reactivan canales', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.connection.estado('CLOSED');
  f.available(false); t.mock.timers.tick(1000); f.connection.reintentar();
  assert.equal(f.reconnect(), 0);
  f.available(true); f.connection.reintentar(); assert.equal(f.reconnect(), 1);
  f.connection.estado('SUBSCRIBED'); f.connection.falloConsulta(); f.connection.pausar();
  t.mock.timers.tick(60000); assert.equal(f.reads(), 1);
  f.connection.estado('CLOSED'); f.connection.cancelar(); t.mock.timers.tick(60000);
  f.connection.reintentar(); assert.equal(f.reconnect(), 1);
});
