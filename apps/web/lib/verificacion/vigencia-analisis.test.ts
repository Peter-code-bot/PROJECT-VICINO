import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DUDAS_ANTERIORES,
  MAX_GRAVES_ANTERIORES,
  MAX_RECHAZOS_ANTERIORES,
  anterioresDeLaNota,
  esRechazo,
  fusionarHistoriales,
  resumenDeLaNota,
  historialConNotaPrevia,
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

test("historial: el veredicto negativo previo pasa a anteriores con su fecha y sin datos del documento", () => {
  const previa = {
    veredicto: "revision_humana", motivo_rechazo_o_duda: "No es de la UMAD", confianza_porcentaje: 40,
    nombre_en_documento: "NO DEBE COPIARSE", entrada: { tipo: "Credencial Universitaria", universidad: "UMAD" },
  };
  const h = historialConNotaPrevia(previa, T2);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], {
    veredicto: "revision_humana", decision: null, aprobable: null, grave: null, motivo_rechazo_o_duda: "No es de la UMAD", confianza_porcentaje: 40,
    entrada: { tipo: "Credencial Universitaria", universidad: "UMAD" }, analizado_en: T2,
  });
  assert.equal(JSON.stringify(h).includes("NO DEBE COPIARSE"), false);
});

test("historial: se acumula entre analisis y un aprobar no entra", () => {
  const n1 = { veredicto: "rechazar", motivo_rechazo_o_duda: "a" };
  const h1 = historialConNotaPrevia(n1, T1);
  const n2 = { veredicto: "aprobar", motivo_rechazo_o_duda: null, anteriores: h1 };
  const h2 = historialConNotaPrevia(n2, T2);
  assert.deepEqual(h2.map((a) => a.motivo_rechazo_o_duda), ["a"]);
  const n3 = { veredicto: "revision_humana", motivo_rechazo_o_duda: "b", anteriores: h2 };
  assert.deepEqual(historialConNotaPrevia(n3, T3).map((a) => a.motivo_rechazo_o_duda), ["a", "b"]);
});

test("historial: el aviso de fallo del proveedor no entra, pero conserva sus anteriores", () => {
  const conAnteriores = { motivo_rechazo_o_duda: "proveedor caido", respuesta_longitud: 0, anteriores: [{ veredicto: "rechazar", motivo_rechazo_o_duda: "x" }] };
  assert.deepEqual(historialConNotaPrevia(conAnteriores, T1).map((a) => a.motivo_rechazo_o_duda), ["x"]);
  assert.deepEqual(historialConNotaPrevia(null, null), []);
  assert.deepEqual(historialConNotaPrevia({ anteriores: "basura" }, null), []);
});

test("historial: tope de rechazos, quedan los mas recientes", () => {
  const muchos = Array.from({ length: MAX_RECHAZOS_ANTERIORES + 5 }, (_, i) => ({ veredicto: "rechazar", motivo_rechazo_o_duda: String(i) }));
  const h = historialConNotaPrevia({ veredicto: "rechazar", motivo_rechazo_o_duda: "ultimo", anteriores: muchos }, T3);
  assert.equal(h.length, MAX_RECHAZOS_ANTERIORES);
  assert.equal(h.at(-1)?.motivo_rechazo_o_duda, "ultimo");
});

test("anterioresDeLaNota lee solo entradas validas", () => {
  assert.deepEqual(anterioresDeLaNota(null), []);
  assert.deepEqual(anterioresDeLaNota({ anteriores: 7 }), []);
  const nota = { anteriores: [{ veredicto: "rechazar", motivo_rechazo_o_duda: "m" }, "basura", { motivo_rechazo_o_duda: "sin veredicto" }] };
  assert.deepEqual(anterioresDeLaNota(nota).map((a) => a.motivo_rechazo_o_duda), ["m"]);
});

test("historial: muchas «revision humana» no desalojan un rechazo (topes separados)", () => {
  let nota: Record<string, unknown> = { veredicto: "rechazar", motivo_rechazo_o_duda: "rechazo fundado", confianza_porcentaje: 92 };
  let t = Date.parse(T1);
  for (let i = 0; i < 25; i++) {
    const anteriores = historialConNotaPrevia(nota, new Date(t).toISOString());
    t += 60_000;
    nota = { veredicto: "revision_humana", motivo_rechazo_o_duda: `borrosa ${i}`, anteriores };
  }
  const h = anterioresDeLaNota(nota);
  assert.ok(h.some((a) => a.motivo_rechazo_o_duda === "rechazo fundado"), "el rechazo sigue");
  assert.equal(h.filter((a) => a.veredicto === "revision_humana").length, MAX_DUDAS_ANTERIORES);
});

test("historial: un «aprobar» del modelo que el servidor rechazo SI entra", () => {
  const h = historialConNotaPrevia({ veredicto: "aprobar", decision: "rejected", motivo_rechazo_o_duda: "cara distinta" }, T1);
  assert.deepEqual(h.map((a) => a.motivo_rechazo_o_duda), ["cara distinta"]);
  assert.deepEqual(historialConNotaPrevia({ veredicto: "aprobar", decision: "pending", motivo_rechazo_o_duda: null }, T1), []);
});

test("fusionarHistoriales une filas sin duplicar y en orden de fecha", () => {
  const filaA = historialConNotaPrevia({ veredicto: "rechazar", motivo_rechazo_o_duda: "A" }, T2);
  const filaB = historialConNotaPrevia({ veredicto: "revision_humana", motivo_rechazo_o_duda: "B", anteriores: filaA }, T3);
  const h = fusionarHistoriales([filaA, filaB, filaA]);
  assert.deepEqual(h.map((a) => a.motivo_rechazo_o_duda), ["A", "B"]);
});

test("el motivo se acota a 300 caracteres", () => {
  const h = historialConNotaPrevia({ veredicto: "rechazar", motivo_rechazo_o_duda: "x".repeat(1000) }, T1);
  assert.equal(h[0]?.motivo_rechazo_o_duda?.length, 300);
});

test("un «aprobar» con alarmas (no aprobable) entra, con motivo del servidor; uno limpio no", () => {
  const conAlarmas = { veredicto: "aprobar", decision: "pending", aprobable: false, motivo_rechazo_o_duda: null, alarmas: ["el rostro no coincide o no es seguro (80 %)"] };
  const h = historialConNotaPrevia(conAlarmas, T1);
  assert.equal(h.length, 1);
  assert.equal(h[0]?.motivo_rechazo_o_duda, "No cuadra: el rostro no coincide o no es seguro (80 %)");
  assert.equal(esRechazo(h[0]!), false);
  assert.deepEqual(historialConNotaPrevia({ veredicto: "aprobar", decision: "pending", aprobable: true, motivo_rechazo_o_duda: null }, T1), []);
});

test("resumenDeLaNota: decision del servidor y motivo de respaldo", () => {
  const r = resumenDeLaNota({ veredicto: "aprobar", decision: "rejected", aprobable: false, motivo_rechazo_o_duda: null, alarmas: ["el nombre no coincide"] });
  assert.equal(r?.decision, "rejected");
  assert.equal(r?.motivo_rechazo_o_duda, "No cuadra: el nombre no coincide");
  assert.equal(resumenDeLaNota({ motivo_rechazo_o_duda: "proveedor caido", respuesta_longitud: 0 }), null);
  assert.equal(resumenDeLaNota(null), null);
});

test("dedupe: el mismo motivo con otra universidad NO se funde", () => {
  const a = { veredicto: "rechazar", motivo_rechazo_o_duda: "no coincide", analizado_en: T1, entrada: { tipo: "Credencial Universitaria", universidad: "UMAD" } };
  const b = { ...a, entrada: { tipo: "Credencial Universitaria", universidad: "Anahuac" } };
  assert.equal(fusionarHistoriales([anterioresDeLaNota({ anteriores: [a, b] })]).length, 2);
});

test("un «aprobar» no aprobable: las alarmas van primero aunque el modelo escribiera algo positivo", () => {
  const r = resumenDeLaNota({ veredicto: "aprobar", aprobable: false, motivo_rechazo_o_duda: "Todo coincide.", alarmas: ["el rostro no coincide o no es seguro (80 %)"] });
  assert.equal(r?.motivo_rechazo_o_duda, "No cuadra: el rostro no coincide o no es seguro (80 %). La IA escribió: Todo coincide.");
});

test("dudas triviales no desalojan una alarma grave (cupos separados)", () => {
  let nota: Record<string, unknown> = { veredicto: "revision_humana", grave: true, motivo_rechazo_o_duda: "el rostro no coincide" };
  let t = Date.parse(T1);
  for (let i = 0; i < 30; i++) {
    const anteriores = historialConNotaPrevia(nota, new Date(t).toISOString());
    t += 60_000;
    nota = { veredicto: "revision_humana", grave: false, motivo_rechazo_o_duda: `borrosa ${i}`, anteriores };
  }
  const h = anterioresDeLaNota(nota);
  assert.ok(h.some((a) => a.motivo_rechazo_o_duda === "el rostro no coincide"), "la grave sigue");
  assert.ok(h.filter((a) => a.grave === true).length <= MAX_GRAVES_ANTERIORES);
  assert.equal(h.filter((a) => a.grave !== true && a.veredicto === "revision_humana").length, MAX_DUDAS_ANTERIORES);
});
