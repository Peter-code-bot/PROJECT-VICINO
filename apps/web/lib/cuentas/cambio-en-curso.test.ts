import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { instalarWindowFalso, type WindowFalso } from "./pruebas-entorno";
import {
  VIGENCIA_CAMBIO_MS,
  cambioEnCurso,
  desmarcarCambioEnCurso,
  hayCambioEnCurso,
  hayCambioEnCursoEnAlgunaPestana,
  marcarCambioEnCurso,
} from "./cambio-en-curso";

let ventana: WindowFalso;
beforeEach(() => {
  ventana = instalarWindowFalso();
  desmarcarCambioEnCurso();
});

test("la marca dice a quien se espera y caduca sola a los 10 s", () => {
  assert.equal(cambioEnCurso(1_000), null);
  marcarCambioEnCurso("b", 1_000);
  assert.equal(cambioEnCurso(1_000), "b");
  assert.equal(hayCambioEnCurso(1_000 + VIGENCIA_CAMBIO_MS), true);
  assert.equal(hayCambioEnCurso(1_000 + VIGENCIA_CAMBIO_MS + 1), false);
  // Caducada, ademas se borra: ni siquiera con el reloj hacia atras reaparece.
  assert.equal(cambioEnCurso(1_000), null);
});

test("desmarcar la quita del almacen y de la memoria", () => {
  marcarCambioEnCurso("b", 5);
  desmarcarCambioEnCurso();
  assert.equal(cambioEnCurso(5), null);
  assert.equal(ventana.sessionStorage.length, 0);
});

test("sin sessionStorage queda el respaldo en memoria", () => {
  ventana.sessionStorage.lanzar = true;
  marcarCambioEnCurso("b", 5);
  assert.equal(cambioEnCurso(6), "b");
  desmarcarCambioEnCurso();
  assert.equal(cambioEnCurso(6), null);
});

test("un reloj que retrocede no deja una marca eterna", () => {
  marcarCambioEnCurso("b", 50_000);
  assert.equal(cambioEnCurso(1_000), null);
});

test("la pista para otras pestañas vive en localStorage, caduca igual y se borra al desmarcar", () => {
  assert.equal(hayCambioEnCursoEnAlgunaPestana(5), false);
  marcarCambioEnCurso("b", 5);
  assert.equal(hayCambioEnCursoEnAlgunaPestana(6), true);
  assert.equal(hayCambioEnCursoEnAlgunaPestana(6 + VIGENCIA_CAMBIO_MS), false);
  desmarcarCambioEnCurso();
  assert.equal(hayCambioEnCursoEnAlgunaPestana(6), false);
  // Sin localStorage no hay pista, pero la marca de esta pestaña sigue.
  ventana.localStorage.lanzar = true;
  marcarCambioEnCurso("b", 5);
  assert.equal(hayCambioEnCurso(6), true);
  assert.equal(hayCambioEnCursoEnAlgunaPestana(6), false);
});
