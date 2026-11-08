import assert from "node:assert/strict";
import test from "node:test";
import { cubetaPorIp } from "./cubeta-ip";

test("misma IP y mismo dia dan la misma cubeta; otro dia u otra IP, otra; la IP nunca va en claro", () => {
  const a = cubetaPorIp("wa-webhook", "203.0.113.9", "2026-11-08", undefined);
  assert.match(a, /^wa-webhook:[A-Za-z0-9_-]{22}$/);
  assert.equal(a, cubetaPorIp("wa-webhook", "203.0.113.9", "2026-11-08", undefined));
  assert.notEqual(a, cubetaPorIp("wa-webhook", "203.0.113.9", "2026-11-09", undefined));
  assert.notEqual(a, cubetaPorIp("wa-webhook", "203.0.113.10", "2026-11-08", undefined));
  assert.ok(!a.includes("203.0.113.9"));
});

test("con sal el resumen es un HMAC distinto del sha256 pelado; una sal corta no cuenta", () => {
  const sin = cubetaPorIp("p", "203.0.113.9", "2026-11-08", undefined);
  const con = cubetaPorIp("p", "203.0.113.9", "2026-11-08", "sal-larga-de-prueba-0123456789");
  const otra = cubetaPorIp("p", "203.0.113.9", "2026-11-08", "otra-sal-larga-de-prueba-9876543210");
  assert.notEqual(sin, con);
  assert.notEqual(con, otra);
  assert.equal(cubetaPorIp("p", "203.0.113.9", "2026-11-08", "corta"), sin);
});
