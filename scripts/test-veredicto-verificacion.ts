/**
 * Casos del veredicto de verificacion de identidad.
 *
 *   npx tsx scripts/test-veredicto-verificacion.ts
 *
 * POR QUE EXISTE. Es la decision mas delicada de la aplicacion: dice si la
 * identidad de alguien se aprueba, se rechaza o la mira una persona. Y un
 * rechazo automatico es en la practica IRREVERSIBLE: 'rejected' es un estado
 * resuelto, asi que el cron de purga borra las tres imagenes en menos de una
 * hora y la cola del panel de admin solo lista 'pending', o sea que nadie
 * puede revisarlo despues.
 *
 * El caso que da nombre a este archivo es el primero: una revision adversarial
 * del 16-sep-2026 encontro que cuatro de los cinco caminos a 'rejected' no
 * exigian ninguna confianza minima, asi que una respuesta con 35% de confianza
 * en el rostro —y con el propio modelo pidiendo revision humana— rechazaba
 * igual. Estos casos existen para que eso no pueda volver.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alarmasDelAnalisis,
  alarmasGraves,
  decidirEstado,
  esAprobable,
  esRechazable,
  type AnalisisDocumento,
  type OpcionesDelVeredicto,
} from "../apps/web/lib/verificacion/veredicto.ts";
import { interpretarRespuesta } from "../apps/web/lib/verificacion/analisis.ts";

/** Lo que hay hoy en produccion: sin aprobacion automatica y con rechazo automatico. */
const COMO_HOY: OpcionesDelVeredicto = { aprobacionAutomatica: false, rechazoAutomatico: true };
/** La aprobacion encendida (solo para probar ese camino; no conviene encenderla). */
const CON_APROBACION: OpcionesDelVeredicto = { aprobacionAutomatica: true, rechazoAutomatico: true };
/** El rechazo automatico apagado (VERIFICACION_RECHAZO_AUTOMATICO=false). */
const SIN_RECHAZO: OpcionesDelVeredicto = { aprobacionAutomatica: false, rechazoAutomatico: false };

/** Un analisis impecable. Cada caso cambia solo lo que quiere probar. */
function analisisPerfecto(): AnalisisDocumento {
  return {
    es_credencial_valida: true,
    tipo_detectado: "INE",
    nombre_en_documento: "Pedro Soriano",
    el_nombre_coincide: true,
    nombre_universidad: null,
    la_universidad_coincide: null,
    vigente: true,
    frente: {
      legible: true,
      vigente: true,
      sellos_o_elementos_de_seguridad: true,
      observacion: null,
    },
    reverso: {
      presente: true,
      legible: true,
      corresponde_al_frente: true,
      observacion: null,
    },
    selfie: {
      rostro_detectado: true,
      misma_persona: true,
      confianza_rostro_porcentaje: 97,
      observacion: null,
    },
    confianza_porcentaje: 96,
    veredicto: "aprobar",
    motivo_rechazo_o_duda: null,
  };
}

function con(cambios: Partial<AnalisisDocumento>): AnalisisDocumento {
  return { ...analisisPerfecto(), ...cambios };
}

// --------------------------------------------------------------------------
// Lo que NO puede rechazar. Cada uno de estos casos rechazaba antes del
// arreglo, y cada rechazo borraba los documentos de alguien en menos de una
// hora sin que ningun humano lo viera.
// --------------------------------------------------------------------------

test("una cara distinta con confianza baja NO rechaza: va a revision humana", () => {
  const a = con({
    selfie: {
      rostro_detectado: true,
      misma_persona: false,
      confianza_rostro_porcentaje: 35,
      observacion: "la selfie tiene reflejo y la foto impresa esta gastada",
    },
    confianza_porcentaje: 40,
    veredicto: "revision_humana",
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "pending");
});

test("un frente ilegible NO rechaza aunque diga que no es una credencial valida", () => {
  const a = con({
    es_credencial_valida: false,
    frente: {
      legible: false,
      vigente: true,
      sellos_o_elementos_de_seguridad: false,
      observacion: "la foto esta quemada por el flash",
    },
    confianza_porcentaje: 95,
    veredicto: "revision_humana",
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "pending");
});

test("un nombre que no coincide con el frente ilegible NO rechaza", () => {
  const a = con({
    el_nombre_coincide: false,
    frente: {
      legible: false,
      vigente: true,
      sellos_o_elementos_de_seguridad: true,
      observacion: null,
    },
    confianza_porcentaje: 88,
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "pending");
});

test("un 'rechazar' con poca confianza NO rechaza", () => {
  const a = con({ veredicto: "rechazar", confianza_porcentaje: 55 });
  assert.equal(decidirEstado(a, false, COMO_HOY), "pending");
});

test("una universidad que no cuadra con el frente ilegible NO rechaza", () => {
  const a = con({
    la_universidad_coincide: false,
    frente: {
      legible: false,
      vigente: true,
      sellos_o_elementos_de_seguridad: true,
      observacion: null,
    },
    confianza_porcentaje: 92,
  });
  assert.equal(decidirEstado(a, true, COMO_HOY), "pending");
});

test("un rostro no detectado NO rechaza: no ver no es un hallazgo", () => {
  const a = con({
    selfie: {
      rostro_detectado: false,
      misma_persona: false,
      confianza_rostro_porcentaje: 0,
      observacion: "no se ve la cara en la selfie",
    },
    veredicto: "revision_humana",
    confianza_porcentaje: 80,
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "pending");
});

// --------------------------------------------------------------------------
// Lo que SI tiene que rechazar. Un piso demasiado alto seria el fallo opuesto:
// documentos falsos aprobados, o colados a una persona que revisa a ojo.
// --------------------------------------------------------------------------

test("dos caras distintas con confianza alta SI rechazan", () => {
  const a = con({
    selfie: {
      rostro_detectado: true,
      misma_persona: false,
      confianza_rostro_porcentaje: 96,
      observacion: "son dos personas distintas",
    },
    veredicto: "rechazar",
    confianza_porcentaje: 94,
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "rejected");
});

test("un documento legible que no es una credencial SI rechaza", () => {
  const a = con({
    es_credencial_valida: false,
    tipo_detectado: "tarjeta de gimnasio",
    veredicto: "rechazar",
    confianza_porcentaje: 93,
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "rejected");
});

test("un nombre sin ninguna relacion, con el frente legible, SI rechaza", () => {
  const a = con({
    el_nombre_coincide: false,
    nombre_en_documento: "Otra Persona Distinta",
    confianza_porcentaje: 91,
    veredicto: "rechazar",
  });
  assert.equal(decidirEstado(a, false, COMO_HOY), "rejected");
});

test("otra universidad, con el frente legible, SI rechaza", () => {
  const a = con({
    la_universidad_coincide: false,
    nombre_universidad: "Otra Universidad",
    confianza_porcentaje: 90,
    veredicto: "revision_humana",
  });
  assert.equal(decidirEstado(a, true, COMO_HOY), "rejected");
});

// --------------------------------------------------------------------------
// La aprobacion, que hoy nace apagada.
// --------------------------------------------------------------------------

test("con la bandera apagada, un analisis impecable se queda en pending", () => {
  assert.equal(decidirEstado(analisisPerfecto(), false, COMO_HOY), "pending");
});

test("con la bandera encendida, un analisis impecable aprueba", () => {
  assert.equal(decidirEstado(analisisPerfecto(), false, CON_APROBACION), "approved");
});

test("el reverso ausente nunca aprueba, ni con la bandera encendida", () => {
  const a = con({
    reverso: { presente: false, legible: false, corresponde_al_frente: false, observacion: null },
  });
  assert.equal(decidirEstado(a, true, CON_APROBACION), "pending");
});

test("un reverso que no corresponde al frente nunca aprueba", () => {
  const a = con({
    reverso: { presente: true, legible: true, corresponde_al_frente: false, observacion: null },
  });
  assert.equal(decidirEstado(a, false, CON_APROBACION), "pending");
});

test("un cotejo de rostro flojo nunca aprueba, aunque diga misma persona", () => {
  const a = con({
    selfie: {
      rostro_detectado: true,
      misma_persona: true,
      confianza_rostro_porcentaje: 60,
      observacion: null,
    },
  });
  assert.equal(decidirEstado(a, false, CON_APROBACION), "pending");
});

test("una credencial universitaria sin cotejo de universidad nunca aprueba", () => {
  // la_universidad_coincide en null significa «no habia nada que cotejar», y
  // en un tramite universitario eso no puede aprobar por descarte.
  const a = con({ la_universidad_coincide: null });
  assert.equal(decidirEstado(a, true, CON_APROBACION), "pending");
});

test("un 'aprobar' con 89 de confianza no aprueba: el umbral es 90", () => {
  const a = con({ confianza_porcentaje: 89 });
  assert.equal(decidirEstado(a, false, CON_APROBACION), "pending");
});

// --------------------------------------------------------------------------
// La frontera por la que entra la respuesta del modelo. Es texto de un tercero
// que decide sobre la identidad de alguien: lo que no se entienda tiene que
// caer del lado seguro, que es null -> revision humana, nunca un veredicto a
// medias.
// --------------------------------------------------------------------------

test("un JSON invalido no se interpreta", () => {
  assert.equal(interpretarRespuesta("{esto no es json"), null);
});

test("una respuesta vacia no se interpreta", () => {
  assert.equal(interpretarRespuesta("   "), null);
});

test("un arreglo no se interpreta, aunque sea JSON valido", () => {
  assert.equal(interpretarRespuesta("[1,2,3]"), null);
});

test("si falta un booleano obligatorio, no se interpreta", () => {
  const sinBooleano = JSON.stringify({
    ...JSON.parse(JSON.stringify(analisisPerfecto())),
    es_credencial_valida: undefined,
  });
  assert.equal(interpretarRespuesta(sinBooleano), null);
});

test("un booleano que llega como cadena no se interpreta", () => {
  // {"chat":"no"} era el caso: una cadena "false" se lee como verdadera por
  // casualidad, no por diseno.
  const comoCadena = JSON.stringify({ ...analisisPerfecto(), el_nombre_coincide: "false" });
  assert.equal(interpretarRespuesta(comoCadena), null);
});

test("un porcentaje fuera de rango se acota en vez de tumbar el analisis", () => {
  const fuera = JSON.stringify({ ...analisisPerfecto(), confianza_porcentaje: 4200 });
  const leido = interpretarRespuesta(fuera);
  assert.notEqual(leido, null);
  assert.ok(leido !== null && leido.confianza_porcentaje <= 100);
});

test("un texto larguisimo se recorta y no tumba el analisis", () => {
  const largo = JSON.stringify({
    ...analisisPerfecto(),
    motivo_rechazo_o_duda: "x".repeat(5000),
  });
  const leido = interpretarRespuesta(largo);
  assert.notEqual(leido, null);
  assert.ok(leido !== null && (leido.motivo_rechazo_o_duda ?? "").length <= 600);
});

test("un veredicto que no conocemos se lee como revision humana", () => {
  const raro = JSON.stringify({ ...analisisPerfecto(), veredicto: "quiza" });
  const leido = interpretarRespuesta(raro);
  assert.notEqual(leido, null);
  assert.equal(leido?.veredicto, "revision_humana");
});

test("una respuesta impecable se interpreta entera y aprobaria con la bandera", () => {
  const leido = interpretarRespuesta(JSON.stringify(analisisPerfecto()));
  assert.notEqual(leido, null);
  assert.ok(leido !== null);
  assert.equal(decidirEstado(leido, false, CON_APROBACION), "approved");
});

test("alarmas: un analisis impecable no tiene ninguna y es aprobable", () => {
  assert.deepEqual(alarmasDelAnalisis(analisisPerfecto(), false), []);
  assert.equal(decidirEstado(analisisPerfecto(), false, CON_APROBACION), "approved");
});

test("alarmas: «aprobar» con el rostro dudoso queda pendiente y dice por que", () => {
  const a = analisisPerfecto();
  a.selfie.confianza_rostro_porcentaje = 80;
  assert.equal(decidirEstado(a, false, CON_APROBACION), "pending");
  assert.deepEqual(alarmasDelAnalisis(a, false), ["el rostro no coincide o no es seguro (80 %)"]);
});

test("alarmas: la lista vacia coincide con «aprobable» en cada condicion de todoCuadra", () => {
  const variantes: Array<(a: AnalisisDocumento) => void> = [
    (a) => { a.confianza_porcentaje = 80; },
    (a) => { a.es_credencial_valida = false; a.confianza_porcentaje = 60; },
    (a) => { a.vigente = false; },
    (a) => { a.frente.vigente = false; },
    (a) => { a.frente.legible = false; },
    (a) => { a.frente.sellos_o_elementos_de_seguridad = false; },
    (a) => { a.reverso.presente = false; },
    (a) => { a.reverso.legible = false; },
    (a) => { a.reverso.corresponde_al_frente = false; },
    (a) => { a.selfie.rostro_detectado = false; },
    (a) => { a.selfie.misma_persona = false; a.selfie.confianza_rostro_porcentaje = 50; },
  ];
  for (const cambiar of variantes) {
    const a = analisisPerfecto();
    cambiar(a);
    const aprobable = decidirEstado(a, false, CON_APROBACION) === "approved";
    assert.equal(alarmasDelAnalisis(a, false).length === 0, aprobable, JSON.stringify(a).slice(0, 80));
  }
  const u = analisisPerfecto();
  u.la_universidad_coincide = false;
  u.confianza_porcentaje = 60;
  assert.equal(decidirEstado(u, true, CON_APROBACION) === "approved", false);
  assert.ok(alarmasDelAnalisis(u, true).includes("la universidad no coincide"));
});

test("alarmas graves: identidad o documento, no una foto mala", () => {
  assert.deepEqual(alarmasGraves(analisisPerfecto(), false), []);
  const borrosa = analisisPerfecto();
  borrosa.frente.legible = false;
  borrosa.confianza_porcentaje = 50;
  assert.deepEqual(alarmasGraves(borrosa, false), []);
  const otraCara = analisisPerfecto();
  otraCara.selfie.misma_persona = false;
  assert.deepEqual(alarmasGraves(otraCara, false), ["el rostro no coincide"]);
});

// --------------------------------------------------------------------------
// El rechazo automatico, controlable (interpretacion A del 7-nov-2026). Hoy
// sigue encendido; con VERIFICACION_RECHAZO_AUTOMATICO=false los cuatro
// caminos de rechazo se quedan en 'pending', en la cola, y la nota conserva
// el hallazgo en `rechazable`. Estos casos fallan contra el decidirEstado de
// tres booleanos: con un objeto en el tercer argumento aquel rechazaba igual.
// --------------------------------------------------------------------------

/** Un analisis por cada camino de rechazo, y SOLO ese camino. */
function losCuatroCaminosDeRechazo(): Array<{ nombre: string; analisis: AnalisisDocumento; esUniversitaria: boolean }> {
  return [
    {
      nombre: "«rechazar» del modelo con confianza suficiente",
      analisis: con({ veredicto: "rechazar", confianza_porcentaje: 80 }),
      esUniversitaria: false,
    },
    {
      nombre: "documento legible que no es una credencial",
      analisis: con({ es_credencial_valida: false, confianza_porcentaje: 93, veredicto: "revision_humana" }),
      esUniversitaria: false,
    },
    {
      nombre: "cara distinta con confianza de rostro alta",
      analisis: con({
        selfie: { rostro_detectado: true, misma_persona: false, confianza_rostro_porcentaje: 96, observacion: null },
        confianza_porcentaje: 60,
        veredicto: "revision_humana",
      }),
      esUniversitaria: false,
    },
    {
      nombre: "otra universidad con el frente legible",
      analisis: con({ la_universidad_coincide: false, confianza_porcentaje: 90, veredicto: "revision_humana" }),
      esUniversitaria: true,
    },
  ];
}

test("rechazo apagado: los cuatro caminos de rechazo quedan en pending y siguen siendo rechazables", () => {
  for (const { nombre, analisis, esUniversitaria } of losCuatroCaminosDeRechazo()) {
    assert.equal(decidirEstado(analisis, esUniversitaria, SIN_RECHAZO), "pending", nombre);
    assert.equal(esRechazable(analisis, esUniversitaria), true, nombre);
    assert.equal(esAprobable(analisis, esUniversitaria), false, nombre);
  }
});

test("rechazo encendido: los cuatro caminos rechazan, igual que hoy, con o sin aprobacion", () => {
  for (const { nombre, analisis, esUniversitaria } of losCuatroCaminosDeRechazo()) {
    assert.equal(decidirEstado(analisis, esUniversitaria, COMO_HOY), "rejected", nombre);
    assert.equal(decidirEstado(analisis, esUniversitaria, CON_APROBACION), "rejected", nombre);
  }
});

test("rechazo apagado: un hallazgo fundado nunca cae a una aprobacion, ni con la aprobacion encendida", () => {
  const soloAprobacion: OpcionesDelVeredicto = { aprobacionAutomatica: true, rechazoAutomatico: false };
  for (const { nombre, analisis, esUniversitaria } of losCuatroCaminosDeRechazo()) {
    assert.equal(decidirEstado(analisis, esUniversitaria, soloAprobacion), "pending", nombre);
  }
});

test("las dos opciones no se pueden intercambiar sin que esto falle", () => {
  const soloAprobacion: OpcionesDelVeredicto = { aprobacionAutomatica: true, rechazoAutomatico: false };
  const soloRechazo: OpcionesDelVeredicto = { aprobacionAutomatica: false, rechazoAutomatico: true };
  const rechazo = losCuatroCaminosDeRechazo()[0];
  assert.ok(rechazo);
  // Un analisis impecable solo lo aprueba la aprobacion...
  assert.equal(decidirEstado(analisisPerfecto(), false, soloAprobacion), "approved");
  assert.equal(decidirEstado(analisisPerfecto(), false, soloRechazo), "pending");
  // ...y un hallazgo fundado solo lo rechaza el rechazo.
  assert.equal(decidirEstado(rechazo.analisis, false, soloAprobacion), "pending");
  assert.equal(decidirEstado(rechazo.analisis, false, soloRechazo), "rejected");
});

test("rechazable y aprobable no dependen de las banderas ni se pisan", () => {
  assert.equal(esAprobable(analisisPerfecto(), false), true);
  assert.equal(esRechazable(analisisPerfecto(), false), false);
  // Una duda (foto borrosa) no es ni lo uno ni lo otro.
  const duda = con({ frente: { legible: false, vigente: true, sellos_o_elementos_de_seguridad: false, observacion: null }, veredicto: "revision_humana", confianza_porcentaje: 50 });
  assert.equal(esAprobable(duda, false), false);
  assert.equal(esRechazable(duda, false), false);
  assert.equal(decidirEstado(duda, false, SIN_RECHAZO), "pending");
});

test("una opcion ausente o que no es exactamente true vale como apagada", () => {
  const rechazo = losCuatroCaminosDeRechazo()[0];
  assert.ok(rechazo);
  const sinTipos = (valor: unknown) => valor as OpcionesDelVeredicto;
  assert.equal(decidirEstado(rechazo.analisis, false, sinTipos({})), "pending");
  assert.equal(decidirEstado(analisisPerfecto(), false, sinTipos({})), "pending");
  assert.equal(decidirEstado(rechazo.analisis, false, sinTipos({ rechazoAutomatico: "false" })), "pending");
  assert.equal(decidirEstado(analisisPerfecto(), false, sinTipos({ aprobacionAutomatica: "true" })), "pending");
});
