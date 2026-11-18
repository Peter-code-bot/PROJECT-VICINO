import assert from "node:assert/strict";
import test from "node:test";
import { sonFotosDistintas } from "./rutas-de-fotos";

const U = "11111111-1111-4111-8111-111111111111";
const CANONICAS = [`${U}/selfie`, `${U}/ine_front`, `${U}/ine_back`];

test("las tres rutas canonicas son tres fotos distintas", () => {
  assert.equal(sonFotosDistintas(CANONICAS), true);
});

test("filas legadas con nombres distintos tambien pasan: no se exigen las canonicas", () => {
  assert.equal(sonFotosDistintas([`${U}/1690000000-selfie.jpg`, `${U}/1690000001-front.jpg`, `${U}/1690000002-back.jpg`]), true);
});

test("la misma ruta en dos ranuras, en cualquier par, no pasa", () => {
  assert.equal(sonFotosDistintas([`${U}/ine_front`, `${U}/ine_front`, `${U}/ine_back`]), false, "selfie = frente");
  assert.equal(sonFotosDistintas([`${U}/selfie`, `${U}/ine_back`, `${U}/ine_back`]), false, "frente = reverso");
  assert.equal(sonFotosDistintas([`${U}/selfie`, `${U}/ine_front`, `${U}/selfie`]), false, "selfie = reverso");
});

test("escrituras distintas del MISMO objeto no pasan", () => {
  const variantes = [
    `${U}/%73elfie`, // %73 = s: el servidor lo decodifica
    `${U}/selfie?x=1`, // la consulta no es parte del objeto
    `${U}/selfie#1`, // el fragmento ni se manda
    `${U}//selfie`,
    `${U}/./selfie`,
    `${U}/%2e/selfie`,
    `${U}\\selfie`, // la URL convierte \ en /
  ];
  for (const variante of variantes) {
    assert.equal(sonFotosDistintas([`${U}/selfie`, variante, `${U}/ine_back`]), false, variante);
  }
});

test("una ruta que no se puede resolver con certeza cuenta como repetida", () => {
  assert.equal(sonFotosDistintas([`${U}/selfie`, `${U}/%E0%A4%A`, `${U}/ine_back`]), false, "%xx roto");
  assert.equal(sonFotosDistintas([`${U}/selfie`, `${U}/%2e%2e/${U}/selfie`, `${U}/ine_back`]), false, ".. escrito %2e%2e");
  assert.equal(sonFotosDistintas([`${U}/selfie`, "", `${U}/ine_back`]), false, "vacia");
});

test("mayusculas distintas son objetos distintos (Storage distingue)", () => {
  assert.equal(sonFotosDistintas([`${U}/selfie`, `${U}/Selfie`, `${U}/ine_back`]), true);
});

// Se construyen con fromCharCode para que el archivo no lleve caracteres invisibles.
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

test("lo que el analizador de URL quita (tabuladores, saltos, espacios y controles del final) no hace distinto al objeto", () => {
  // Con new URL en Node: «uid/ine_front », «uid/ine_fr<TAB>ont», «uid/ine_front<LF>»
  // y «uid/ine_front<NUL>», al final de la URL de descarga, piden «uid/ine_front».
  const variantes = [`${U}/ine_front `, `${U}/ine_fr\tont`, `${U}/ine_front\n`, `${U}/ine_front\r`, `${U}/ine_front${NUL}`];
  for (const variante of variantes) {
    assert.equal(sonFotosDistintas([variante, `${U}/ine_front`, `${U}/ine_back`]), false, JSON.stringify(variante));
  }
});

test("una ruta con controles o espacios en los bordes cuenta como repetida aunque no choque con otra", () => {
  const ambiguas = [
    `${U}/ine_front `,
    ` ${U}/ine_front`,
    `${U}/ine_${DEL}front`, // DEL no se quita: se codifica, y que hace el servidor no se sabe
    `${U}/ine_${String.fromCharCode(1)}front`,
    `${U}/ine_front%20`, // lo mismo escrito con %xx
    `${U}/ine_front%09`,
    `${U}/ine_front%00`,
    `${U}/ine_front ?x=1`, // el espacio antes de la consulta se codifica en vez de quitarse
  ];
  for (const ruta of ambiguas) {
    assert.equal(sonFotosDistintas([`${U}/selfie`, ruta, `${U}/ine_back`]), false, JSON.stringify(ruta));
  }
});

test("un espacio en medio no es ambiguo: la URL lo codifica y es el mismo objeto que su %20", () => {
  assert.equal(sonFotosDistintas([`${U}/foto frente.jpg`, `${U}/ine_front`, `${U}/ine_back`]), true);
  assert.equal(sonFotosDistintas([`${U}/foto frente.jpg`, `${U}/foto%20frente.jpg`, `${U}/ine_back`]), false);
});
