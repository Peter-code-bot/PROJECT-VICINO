import assert from "node:assert/strict";
import test from "node:test";
import {
  esVeredictoDeEstaEntrada,
  esVeredictoReal,
  estadoDelAnalisis,
  versionesDeLasFotos,
  versionMasReciente,
} from "./vigencia-analisis";

const U = "11111111-1111-1111-1111-111111111111";
const RUTAS = [`${U}/selfie`, `${U}/ine_front`, `${U}/ine_back`];
const T1 = "2026-09-27T09:00:00.000Z";
const T2 = "2026-09-27T09:05:00.000Z";
const T3 = "2026-09-27T09:10:00.000Z";

test("versionesDeLasFotos empareja por carpeta/nombre y respeta el orden de las rutas", () => {
  const objetos = [
    { name: "ine_back", updated_at: T3 },
    { name: "selfie", updated_at: T1 },
    { name: "ine_front", updated_at: T2 },
    { name: "otra-cosa.png", updated_at: T3 },
  ];
  assert.deepEqual(versionesDeLasFotos(U, RUTAS, objetos), [T1, T2, T3]);
});

test("una ruta que no esta en el listado, o con fecha invalida, sale null", () => {
  const objetos = [{ name: "selfie", updated_at: T1 }, { name: "ine_front", updated_at: "no-es-fecha" }];
  assert.deepEqual(versionesDeLasFotos(U, RUTAS, objetos), [T1, null, null]);
});

test("no confunde la carpeta de otra persona", () => {
  const otra = "22222222-2222-2222-2222-222222222222";
  assert.deepEqual(versionesDeLasFotos(otra, RUTAS, [{ name: "selfie", updated_at: T1 }]), [null, null, null]);
});

test("versionMasReciente: la mayor, o null si falta alguna", () => {
  assert.equal(versionMasReciente([T2, T3, T1]), T3);
  assert.equal(versionMasReciente([T2, null, T1]), null);
  assert.equal(versionMasReciente([]), null);
});

test("sin nota: ninguno", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: false, vigente: true, analizadoEn: T3, versiones: [T1, T2, T3] }), "ninguno");
});

test("la fila cambio despues de la nota: desfasado aunque las fotos sean viejas", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: false, analizadoEn: T3, versiones: [T1, T2, T3] }), "desfasado");
});

test("una foto reemplazada en el bucket despues del analisis: desfasado", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T2, versiones: [T1, T2, T3] }), "desfasado");
});

test("todas las fotos son anteriores o iguales a lo analizado: vigente", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T3, versiones: [T1, T2, T3] }), "vigente");
});

test("nota sin fecha, listado fallido o foto ausente: sin_comprobar, nunca vigente", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: null, versiones: [T1, T2, T3] }), "sin_comprobar");
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T3, versiones: null }), "sin_comprobar");
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T3, versiones: [T1, null, T2] }), "sin_comprobar");
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: "basura", versiones: [T1] }), "sin_comprobar");
});

test("una foto posterior decide aunque falte otra", () => {
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T1, versiones: [null, T2] }), "desfasado");
});

test("una ranura vacia (columna nula) sale null y el estado no puede ser vigente", () => {
  const objetos = [{ name: "selfie", updated_at: T1 }];
  const versiones = versionesDeLasFotos(U, [`${U}/selfie`, null, null], objetos);
  assert.deepEqual(versiones, [T1, null, null]);
  assert.equal(estadoDelAnalisis({ hayAnalisis: true, vigente: true, analizadoEn: T3, versiones }), "sin_comprobar");
});

test("esVeredictoReal distingue el aviso de fallo del proveedor", () => {
  assert.equal(esVeredictoReal({ motivo_rechazo_o_duda: "x", respuesta_longitud: 0 }), false);
  assert.equal(esVeredictoReal({ veredicto: "revision_humana", motivo_rechazo_o_duda: "x" }), true);
  assert.equal(esVeredictoReal(null), false);
  assert.equal(esVeredictoReal([]), false);
});

test("esVeredictoDeEstaEntrada: misma version de fotos, tipo y universidad", () => {
  const nota = { veredicto: "revision_humana", entrada: { tipo: "Credencial Universitaria", universidad: "UMAD" } };
  const entrada = { tipo: "Credencial Universitaria", universidad: "UMAD" };
  // Mismo instante escrito distinto (PostgREST devuelve +00:00 y microsegundos).
  assert.equal(esVeredictoDeEstaEntrada(nota, "2026-09-27T09:10:00+00:00", T3, entrada), true);
  assert.equal(esVeredictoDeEstaEntrada(nota, T2, T3, entrada), false, "fotos nuevas");
  assert.equal(esVeredictoDeEstaEntrada(nota, T3, T3, { ...entrada, universidad: "Anahuac" }), false, "otra universidad");
  assert.equal(esVeredictoDeEstaEntrada(nota, T3, T3, { tipo: "INE", universidad: null }), false, "otro tipo");
  assert.equal(esVeredictoDeEstaEntrada({ veredicto: "x" }, T3, T3, entrada), false, "nota sin entrada (anterior)");
  assert.equal(esVeredictoDeEstaEntrada({ ...nota, respuesta_longitud: 3 }, T3, T3, entrada), false, "aviso de fallo");
  assert.equal(esVeredictoDeEstaEntrada(nota, null, T3, entrada), false);
});
