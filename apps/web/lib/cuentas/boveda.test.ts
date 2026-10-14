import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { instalarWindowFalso, type WindowFalso } from "./pruebas-entorno";
import {
  CLAVE_BOVEDA,
  MAX_CUENTAS,
  actualizarPerfil,
  actualizarTokens,
  buscarCuenta,
  cuentaMasReciente,
  cuentasDormidas,
  guardarCuenta,
  instantaneaBoveda,
  instantaneaBovedaServidor,
  interpretarBoveda,
  leerCuentas,
  quitarCuenta,
  suscribirBoveda,
  vaciarBoveda,
  type DatosCuenta,
} from "./boveda";

let ventana: WindowFalso;
beforeEach(() => {
  ventana = instalarWindowFalso();
});

function cuenta(n: number, extra: Partial<DatosCuenta> = {}): DatosCuenta {
  return {
    userId: `00000000-0000-4000-8000-00000000000${n}`,
    email: `persona${n}@correo.mx`,
    nombre: `Persona ${n}`,
    username: `persona${n}`,
    foto: null,
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    ...extra,
  };
}

test("una entrada invalida se descarta sin tirar las demas", () => {
  const crudo = JSON.stringify([
    { ...cuenta(1), ultimoUso: 10 },
    { userId: "no-es-uuid", email: "x", nombre: "", username: null, foto: null, accessToken: "a", refreshToken: "r", ultimoUso: 20 },
    { ...cuenta(2), ultimoUso: 30, refreshToken: "" },
    "basura",
    { ...cuenta(3), ultimoUso: 40 },
  ]);
  const cuentas = interpretarBoveda(crudo);
  assert.deepEqual(cuentas.map((c) => c.userId), [cuenta(3).userId, cuenta(1).userId]);
});

test("JSON corrupto, un objeto que no es lista y un servidor sin dispositivo dan lista vacia", () => {
  assert.deepEqual(interpretarBoveda("{no es json"), []);
  assert.deepEqual(interpretarBoveda(JSON.stringify({ userId: "x" })), []);
  assert.deepEqual(interpretarBoveda(instantaneaBovedaServidor()), []);
  ventana.localStorage.lanzar = true;
  assert.deepEqual(leerCuentas(), []);
  assert.equal(instantaneaBoveda(), "[]");
});

test("se ordena por ultimo uso y la misma userId no se duplica", () => {
  assert.equal(guardarCuenta(cuenta(1), 100), "guardada");
  assert.equal(guardarCuenta(cuenta(2), 200), "guardada");
  assert.equal(guardarCuenta(cuenta(1, { nombre: "Persona 1 editada", accessToken: "access-1b" }), 300), "guardada");
  const cuentas = leerCuentas();
  assert.equal(cuentas.length, 2);
  assert.equal(cuentas[0]?.userId, cuenta(1).userId);
  assert.equal(cuentas[0]?.nombre, "Persona 1 editada");
  assert.equal(cuentas[0]?.accessToken, "access-1b");
  assert.equal(cuentas[1]?.userId, cuenta(2).userId);
  assert.equal(cuentaMasReciente()?.userId, cuenta(1).userId);
  assert.equal(cuentaMasReciente(cuenta(1).userId)?.userId, cuenta(2).userId);
  assert.deepEqual(cuentasDormidas(cuenta(1).userId).map((c) => c.userId), [cuenta(2).userId]);
  assert.equal(buscarCuenta(cuenta(2).userId)?.email, "persona2@correo.mx");
  assert.equal(buscarCuenta("00000000-0000-4000-8000-000000000009"), null);
});

test("el tope de cuentas no expulsa a nadie en silencio, pero deja actualizar las que ya estan", () => {
  for (let n = 1; n <= MAX_CUENTAS; n++) assert.equal(guardarCuenta(cuenta(n), n), "guardada");
  assert.equal(guardarCuenta(cuenta(6), 99), "llena");
  assert.equal(leerCuentas().length, MAX_CUENTAS);
  assert.equal(leerCuentas().some((c) => c.userId === cuenta(6).userId), false);
  assert.equal(guardarCuenta(cuenta(1, { accessToken: "nuevo" }), 100), "guardada");
  assert.equal(buscarCuenta(cuenta(1).userId)?.accessToken, "nuevo");
});

test("sin almacenamiento, guardar lo dice en vez de prometer", () => {
  ventana.localStorage.lanzar = true;
  assert.equal(guardarCuenta(cuenta(1), 1), "sin_almacenamiento");
  // Quitar y vaciar no lanzan aunque el almacen falle.
  quitarCuenta(cuenta(1).userId);
  vaciarBoveda();
});

test("quitar y vaciar notifican a los oyentes; otra pestaña entra por el evento storage", () => {
  let avisos = 0;
  const baja = suscribirBoveda(() => avisos++);
  guardarCuenta(cuenta(1), 1);
  guardarCuenta(cuenta(2), 2);
  quitarCuenta(cuenta(1).userId);
  assert.deepEqual(leerCuentas().map((c) => c.userId), [cuenta(2).userId]);
  quitarCuenta(cuenta(1).userId); // ya no esta: no escribe ni avisa
  assert.equal(avisos, 3);
  ventana.disparar("storage");
  assert.equal(avisos, 4);
  vaciarBoveda();
  assert.equal(leerCuentas().length, 0);
  assert.equal(ventana.localStorage.getItem(CLAVE_BOVEDA), null);
  assert.equal(avisos, 5);
  baja();
  guardarCuenta(cuenta(3), 3);
  assert.equal(avisos, 5);
});

test("actualizar tokens o perfil no crea entradas ni cambia el orden", () => {
  guardarCuenta(cuenta(1), 100);
  guardarCuenta(cuenta(2), 200);
  assert.equal(actualizarTokens(cuenta(3).userId, { accessToken: "a", refreshToken: "r" }), false);
  assert.equal(actualizarTokens(cuenta(1).userId, { accessToken: "a-1b", refreshToken: "r-1b" }), true);
  assert.equal(buscarCuenta(cuenta(1).userId)?.refreshToken, "r-1b");
  assert.equal(actualizarPerfil(cuenta(3).userId, { nombre: "x", username: null, foto: null, email: "" }), false);
  assert.equal(actualizarPerfil(cuenta(1).userId, { nombre: "Persona Uno", username: "uno", foto: "https://x/1.png", email: "" }), true);
  const uno = buscarCuenta(cuenta(1).userId)!;
  assert.equal(uno.nombre, "Persona Uno");
  assert.equal(uno.username, "uno");
  assert.equal(uno.email, "persona1@correo.mx", "un correo vacio no pisa el guardado");
  assert.equal(uno.refreshToken, "r-1b", "el perfil no toca los tokens");
  // Ni tokens ni perfil mueven a la cuenta de sitio: la 2 sigue siendo la mas reciente.
  assert.equal(leerCuentas()[0]?.userId, cuenta(2).userId);
  // Sin cambios no se escribe (ni se avisa).
  let avisos = 0;
  const baja = suscribirBoveda(() => avisos++);
  assert.equal(actualizarTokens(cuenta(1).userId, { accessToken: "a-1b", refreshToken: "r-1b" }), true);
  assert.equal(actualizarPerfil(cuenta(1).userId, { nombre: "Persona Uno", username: "uno", foto: "https://x/1.png", email: "persona1@correo.mx" }), true);
  assert.equal(avisos, 0);
  baja();
});

function jwt(claims: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(claims))}.firma`;
}

test("actualizar tokens solo acepta rotaciones de la MISMA sesion de GoTrue; otra sesion la registra guardarCuenta", () => {
  const s1 = jwt({ sub: cuenta(1).userId, session_id: "s-1" });
  guardarCuenta(cuenta(1, { accessToken: s1, refreshToken: "r-s1" }), 100);
  // Rotacion dentro de s-1: se acepta.
  assert.equal(actualizarTokens(cuenta(1).userId, { accessToken: jwt({ sub: "x", session_id: "s-1" }), refreshToken: "r-s1-b" }), true);
  assert.equal(buscarCuenta(cuenta(1).userId)?.refreshToken, "r-s1-b");
  // Otra sesion (volvio a entrar por /login): el espejo NO la pisa, para que
  // RegistroCuentaActiva vea la vieja, la revoque y guarde la nueva.
  const s2 = jwt({ sub: "x", session_id: "s-2" });
  assert.equal(actualizarTokens(cuenta(1).userId, { accessToken: s2, refreshToken: "r-s2" }), false);
  assert.equal(buscarCuenta(cuenta(1).userId)?.refreshToken, "r-s1-b");
  assert.equal(guardarCuenta(cuenta(1, { accessToken: s2, refreshToken: "r-s2" }), 200), "guardada");
  assert.equal(buscarCuenta(cuenta(1).userId)?.refreshToken, "r-s2");
  // Tokens que no son JWT legibles (sin session_id): se acepta, como antes.
  assert.equal(actualizarTokens(cuenta(1).userId, { accessToken: "opaco", refreshToken: "r-opaco" }), true);
});

test("un perfil en blanco (consulta fallida) no pisa el guardado", () => {
  guardarCuenta(cuenta(1), 100);
  assert.equal(actualizarPerfil(cuenta(1).userId, { nombre: "", username: null, foto: null, email: "" }), true);
  assert.equal(buscarCuenta(cuenta(1).userId)?.nombre, "Persona 1");
  assert.equal(buscarCuenta(cuenta(1).userId)?.username, "persona1");
  // Quitar el usuario de verdad (queda nombre) si se refleja.
  assert.equal(actualizarPerfil(cuenta(1).userId, { nombre: "Persona 1", username: null, foto: null, email: "" }), true);
  assert.equal(buscarCuenta(cuenta(1).userId)?.username, null);
});

test("la instantanea es el string crudo, estable entre lecturas", () => {
  guardarCuenta(cuenta(1), 1);
  assert.equal(instantaneaBoveda(), instantaneaBoveda());
  assert.equal(instantaneaBoveda(), ventana.localStorage.getItem(CLAVE_BOVEDA));
});
