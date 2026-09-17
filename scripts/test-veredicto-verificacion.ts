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
  decidirEstado,
  type AnalisisDocumento,
} from "../apps/web/lib/verificacion/veredicto.ts";
import { interpretarRespuesta } from "../apps/web/lib/verificacion/analisis.ts";

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
  assert.equal(decidirEstado(a, false, false), "pending");
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
  assert.equal(decidirEstado(a, false, false), "pending");
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
  assert.equal(decidirEstado(a, false, false), "pending");
});

test("un 'rechazar' con poca confianza NO rechaza", () => {
  const a = con({ veredicto: "rechazar", confianza_porcentaje: 55 });
  assert.equal(decidirEstado(a, false, false), "pending");
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
  assert.equal(decidirEstado(a, true, false), "pending");
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
  assert.equal(decidirEstado(a, false, false), "pending");
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
  assert.equal(decidirEstado(a, false, false), "rejected");
});

test("un documento legible que no es una credencial SI rechaza", () => {
  const a = con({
    es_credencial_valida: false,
    tipo_detectado: "tarjeta de gimnasio",
    veredicto: "rechazar",
    confianza_porcentaje: 93,
  });
  assert.equal(decidirEstado(a, false, false), "rejected");
});

test("un nombre sin ninguna relacion, con el frente legible, SI rechaza", () => {
  const a = con({
    el_nombre_coincide: false,
    nombre_en_documento: "Otra Persona Distinta",
    confianza_porcentaje: 91,
    veredicto: "rechazar",
  });
  assert.equal(decidirEstado(a, false, false), "rejected");
});

test("otra universidad, con el frente legible, SI rechaza", () => {
  const a = con({
    la_universidad_coincide: false,
    nombre_universidad: "Otra Universidad",
    confianza_porcentaje: 90,
    veredicto: "revision_humana",
  });
  assert.equal(decidirEstado(a, true, false), "rejected");
});

// --------------------------------------------------------------------------
// La aprobacion, que hoy nace apagada.
// --------------------------------------------------------------------------

test("con la bandera apagada, un analisis impecable se queda en pending", () => {
  assert.equal(decidirEstado(analisisPerfecto(), false, false), "pending");
});

test("con la bandera encendida, un analisis impecable aprueba", () => {
  assert.equal(decidirEstado(analisisPerfecto(), false, true), "approved");
});

test("el reverso ausente nunca aprueba, ni con la bandera encendida", () => {
  const a = con({
    reverso: { presente: false, legible: false, corresponde_al_frente: false, observacion: null },
  });
  assert.equal(decidirEstado(a, true, true), "pending");
});

test("un reverso que no corresponde al frente nunca aprueba", () => {
  const a = con({
    reverso: { presente: true, legible: true, corresponde_al_frente: false, observacion: null },
  });
  assert.equal(decidirEstado(a, false, true), "pending");
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
  assert.equal(decidirEstado(a, false, true), "pending");
});

test("una credencial universitaria sin cotejo de universidad nunca aprueba", () => {
  // la_universidad_coincide en null significa «no habia nada que cotejar», y
  // en un tramite universitario eso no puede aprobar por descarte.
  const a = con({ la_universidad_coincide: null });
  assert.equal(decidirEstado(a, true, true), "pending");
});

test("un 'aprobar' con 89 de confianza no aprueba: el umbral es 90", () => {
  const a = con({ confianza_porcentaje: 89 });
  assert.equal(decidirEstado(a, false, true), "pending");
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
  assert.equal(decidirEstado(leido, false, true), "approved");
});
