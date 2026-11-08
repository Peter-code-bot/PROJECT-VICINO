import assert from "node:assert/strict";
import test from "node:test";
import {
  CODIGO_RESPUESTA_INESPERADA,
  CODIGO_SIN_CONFIGURAR,
  etiquetaUltimoMensaje,
  mensajeParaUsuario,
  numeroLegible,
  textoDeMensaje,
} from "./presentacion";

test("textoDeMensaje: texto plano tal cual, adjunto con pie precedido de su etiqueta, sin texto solo la etiqueta", () => {
  assert.equal(textoDeMensaje({ tipo: "text", texto: "hola" }), "hola");
  assert.equal(textoDeMensaje({ tipo: "image", texto: "mi pastel" }), "[Imagen] mi pastel");
  assert.equal(textoDeMensaje({ tipo: "audio", texto: null }), "[Audio]");
  assert.equal(textoDeMensaje({ tipo: "location", texto: "Casa" }), "[Ubicación] Casa");
  assert.equal(textoDeMensaje({ tipo: "lo_que_sea", texto: null }), "[Adjunto]");
  assert.equal(textoDeMensaje({ tipo: "unsupported", texto: null }), "[Mensaje no compatible con la bandeja]");
});

test("etiquetaUltimoMensaje traduce el tipo entre corchetes que guarda la base y deja el texto normal", () => {
  assert.equal(etiquetaUltimoMensaje("[image]"), "[Imagen]");
  assert.equal(etiquetaUltimoMensaje("[unknown]"), "[Mensaje no compatible con la bandeja]");
  assert.equal(etiquetaUltimoMensaje("[cosa_rara]"), "[cosa_rara]"); // no casa el regex (guion bajo): se deja
  assert.equal(etiquetaUltimoMensaje("[x9]"), "[x9]");
  assert.equal(etiquetaUltimoMensaje("hola [image]"), "hola [image]");
  assert.equal(etiquetaUltimoMensaje(null), "Sin mensajes todavía");
  assert.equal(etiquetaUltimoMensaje(""), "Sin mensajes todavía");
});

test("mensajeParaUsuario: codigos propios, codigos de Meta, sin codigo y por defecto; nunca ingles ni internos", () => {
  assert.match(mensajeParaUsuario(CODIGO_SIN_CONFIGURAR), /no está configurado/);
  assert.match(mensajeParaUsuario(CODIGO_RESPUESTA_INESPERADA), /error interno/);
  assert.match(mensajeParaUsuario(131047), /24 horas/);
  assert.match(mensajeParaUsuario(131030), /destinatarios de prueba/);
  assert.match(mensajeParaUsuario(190), /token/);
  assert.match(mensajeParaUsuario(null), /Revisa tu conexión/);
  assert.match(mensajeParaUsuario(undefined), /Revisa tu conexión/);
  assert.equal(mensajeParaUsuario(999999), "WhatsApp no aceptó el mensaje (código 999999).");
  for (const codigo of [CODIGO_SIN_CONFIGURAR, CODIGO_RESPUESTA_INESPERADA, 131047, 190, null, 999999]) {
    const m = mensajeParaUsuario(codigo);
    assert.ok(!/HTTP|fbtrace|WHATSAPP_/.test(m), m);
  }
});

test("numeroLegible antepone el +", () => {
  assert.equal(numeroLegible("5215512345678"), "+5215512345678");
});
