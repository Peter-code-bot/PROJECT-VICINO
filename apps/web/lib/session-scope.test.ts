import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { homeSessionKey, locationScopeFromDocumentCookie, locationScopeFromPairs } from "./session-scope";

// El parser REAL de Next (el que hay detras de `cookies()`), para comparar las
// dos capas con la misma cabecera Cookie.
const requerir = createRequire(__filename);
const { RequestCookies } = requerir("next/dist/compiled/@edge-runtime/cookies") as {
  RequestCookies: new (headers: Headers) => { getAll(): Array<{ name: string; value: string }> };
};
const servidor = (cabecera: string) => locationScopeFromPairs(new RequestCookies(new Headers({ cookie: cabecera })).getAll());
const cliente = (cabecera: string) => locationScopeFromDocumentCookie(cabecera);

// Coordenadas genericas de dos centros urbanos.
const PUEBLA = "vicino_location=19.041,-98.206; vicino_radius=10000";
const CHOLULA = "vicino_location=19.063,-98.306; vicino_radius=10000";

test("sin cookies de zona el ambito sigue siendo la cadena vacia en las dos capas", () => {
  for (const cabecera of ["", "sb-auth=abc; otra=1"]) {
    assert.equal(servidor(cabecera), "");
    assert.equal(cliente(cabecera), "");
  }
});

test("servidor y cliente calculan la MISMA clave para la misma cabecera", () => {
  for (const cabecera of [
    PUEBLA,
    `sb-auth=abc; ${PUEBLA}; tema=oscuro`,
    "vicino_location=19.041%2C-98.206; vicino_radius=10000", // escrita con encodeURIComponent
    "vicino_location=40.000,-120.000", // fuera del area del mapa
    "vicino_location=basura; vicino_radius=999",
    "vicino_radius=25000",
    "vicino_location=19.041,-98.206; vicino_location=19.063,-98.306", // repetida: gana la ultima
    "vicino_location; vicino_radius=10000", // sin "=": Next la lee como "true"
    "vicino_location=%E0%A4%A; vicino_radius=10000", // mal codificada: se descarta
  ]) {
    assert.equal(cliente(cabecera), servidor(cabecera), cabecera);
  }
});

test("la clave no lleva la cookie ni las coordenadas en claro", () => {
  const ambito = servidor(PUEBLA);
  assert.match(ambito, /^zona:[0-9a-f]{16}$/);
  const clave = homeSessionKey("parati", ambito);
  for (const literal of ["vicino_location", "vicino_radius", "19.041", "98.206", "10000"]) {
    assert.equal(clave.includes(literal), false, literal);
  }
});

test("zonas o radios distintos dan claves distintas; la misma zona escrita distinto, la misma", () => {
  assert.notEqual(servidor(PUEBLA), servidor(CHOLULA));
  assert.notEqual(servidor(PUEBLA), servidor("vicino_location=19.041,-98.206; vicino_radius=25000"));
  // 4 decimales: el servidor consulta el mismo punto redondeado, asi que es la misma zona.
  assert.equal(servidor("vicino_location=19.0414,-98.2063; vicino_radius=10000"), servidor(PUEBLA));
  // Radio ausente y radio por defecto son el mismo feed.
  assert.equal(servidor("vicino_location=19.041,-98.206"), servidor(PUEBLA));
});

test("el centinela de hidratacion no pasa por la huella", () => {
  assert.ok(homeSessionKey(null, "unhydrated").endsWith("#unhydrated"));
  assert.ok(homeSessionKey("solicitudes", "").endsWith("?feed=solicitudes#"));
});
