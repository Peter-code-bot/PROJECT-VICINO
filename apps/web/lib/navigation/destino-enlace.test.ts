import assert from "node:assert/strict";
import test from "node:test";
import { destinoDeEnlace } from "./destino-enlace";

// Construida y no escrita, como en scripts/test-destino-seguro.ts: un escape
// mal puesto en un literal no falla, solo deja de probar lo que crees probar.
const BARRA_INVERTIDA = String.fromCharCode(92);

test("la raiz con query conserva la barra: no se pega a la pantalla abierta", () => {
  // El caso del arreglo: con la app en /perfil, '?feed=solicitudes' a secas se
  // resolvia como /perfil?feed=solicitudes.
  assert.equal(destinoDeEnlace("https://vicinomarket.com/?feed=solicitudes"), "/?feed=solicitudes");
  assert.equal(destinoDeEnlace("https://www.vicinomarket.com/?feed=solicitudes"), "/?feed=solicitudes");
});

test("ruta, query y hash completos, con cualquiera de los hosts", () => {
  assert.equal(
    destinoDeEnlace("https://www.vicinomarket.com/comida/pan-dulce?x=1#fotos"),
    "/comida/pan-dulce?x=1#fotos",
  );
  assert.equal(destinoDeEnlace("https://vicinomarket.com/#seccion"), "/#seccion");
  assert.equal(destinoDeEnlace("https://startup-marketplace-web.vercel.app/terminos"), "/terminos");
});

test("la raiz sin query no navega, igual que antes", () => {
  for (const url of ["https://vicinomarket.com", "https://vicinomarket.com/", "https://www.vicinomarket.com/"]) {
    assert.equal(destinoDeEnlace(url), null, url);
  }
});

test("una ruta que el navegador leeria como otro host no navega", () => {
  // //host es una URL de protocolo relativo: location.href saldria de la app.
  assert.equal(destinoDeEnlace("https://vicinomarket.com//evil.example/x?y=1"), null);
  // En los esquemas especiales, new URL convierte la barra invertida en barra.
  assert.equal(destinoDeEnlace("https://www.vicinomarket.com/" + BARRA_INVERTIDA + "evil.example/x"), null);
});

test("las barras codificadas siguen siendo una ruta interna", () => {
  assert.equal(destinoDeEnlace("https://vicinomarket.com/%2F%2Fevil.example"), "/%2F%2Fevil.example");
});

test("lo que no es una URL no navega", () => {
  for (const url of ["no es url", ""]) assert.equal(destinoDeEnlace(url), null, JSON.stringify(url));
});

// Hoy nadie genera enlaces vicino:// salvo OAuth y FCM, que se atienden antes.
test("el esquema propio usa la ruta y no el host, como antes", () => {
  assert.equal(destinoDeEnlace("vicino://app/perfil?x=1"), "/perfil?x=1");
});

test("el esquema propio sin ruta ya no navega a una query relativa", () => {
  // Antes daba '?x=1', el mismo fallo que la raiz con query.
  assert.equal(destinoDeEnlace("vicino://perfil?x=1"), null);
});
