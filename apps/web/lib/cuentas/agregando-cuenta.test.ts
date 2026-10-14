import assert from "node:assert/strict";
import test from "node:test";
import {
  COOKIE_AGREGANDO_CUENTA,
  DESTINO_TRAS_AGREGAR,
  estaAgregandoCuenta,
  expulsarDePantallaDeEntrada,
  hrefAgregarCuenta,
} from "./agregando-cuenta";
import { destinoAutenticadoSeguro } from "../auth/destino-seguro";

test("solo el valor exacto activa la excepcion", () => {
  assert.equal(estaAgregandoCuenta("1"), true);
  for (const valor of ["", "0", "true", "11", undefined, null]) assert.equal(estaAgregandoCuenta(valor), false, String(valor));
});

test("el enlace de agregar conserva la intencion y vuelve a /perfil, que es un destino seguro", () => {
  const url = new URL(hrefAgregarCuenta("/login"), "https://vicino.invalid");
  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("agregar"), "1");
  assert.equal(url.searchParams.get("next"), DESTINO_TRAS_AGREGAR);
  assert.equal(destinoAutenticadoSeguro(url.searchParams.get("next")), DESTINO_TRAS_AGREGAR);
  assert.equal(new URL(hrefAgregarCuenta("/register"), "https://vicino.invalid").pathname, "/register");
});

test("el proxy echa de /login y /register con sesion, salvo que se este agregando otra cuenta", () => {
  for (const ruta of ["/login", "/login/", "/register", "/register/x"]) {
    assert.equal(expulsarDePantallaDeEntrada(true, ruta, undefined), true, ruta);
    assert.equal(expulsarDePantallaDeEntrada(true, ruta, "1"), false, `${ruta} agregando`);
    assert.equal(expulsarDePantallaDeEntrada(false, ruta, undefined), false, `${ruta} sin sesion`);
  }
  // Un valor que no sea exactamente "1" no abre la excepcion.
  assert.equal(expulsarDePantallaDeEntrada(true, "/login", "true"), true);
  // Fuera de las pantallas de entrada no se expulsa a nadie, con o sin cookie.
  for (const ruta of ["/", "/perfil", "/loginx", "/forgot-password", "/auth/callback-server"]) {
    assert.equal(expulsarDePantallaDeEntrada(true, ruta, undefined), false, ruta);
    assert.equal(expulsarDePantallaDeEntrada(true, ruta, "1"), false, `${ruta} agregando`);
  }
});

test("el nombre de la cookie no lleva nada que un navegador rechace", () => {
  assert.match(COOKIE_AGREGANDO_CUENTA, /^[a-z_]+$/);
});
