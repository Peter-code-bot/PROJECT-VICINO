import assert from "node:assert/strict";
import test from "node:test";
import { abreTeclado, type ElementoEnfocado } from "./abre-teclado";

interface Opciones {
  type?: string;
  readOnly?: boolean;
  inputMode?: string;
  isContentEditable?: boolean;
  /** Simula `:disabled`, propio o heredado de un `<fieldset disabled>`. */
  disabled?: boolean;
}

function elemento(localName: string, { disabled = false, ...propiedades }: Opciones = {}): ElementoEnfocado {
  return { localName, ...propiedades, matches: (selector) => selector === ":disabled" && disabled };
}

const TIPOS_CON_TECLADO = ["text", "email", "number", "search", "tel", "url", "password"];
const TIPOS_SIN_TECLADO = [
  "radio", "checkbox", "button", "submit", "reset", "image", "range", "color", "file", "hidden",
  "date", "time", "datetime-local", "month", "week",
];

test("un input sin atributo type es de texto y abre teclado", () => {
  assert.equal(abreTeclado(elemento("input")), true, "type ausente");
  assert.equal(abreTeclado(elemento("input", { type: "" })), true, "type vacío");
  assert.equal(abreTeclado(elemento("input", { type: "text" })), true, "type text");
});

test("el type se compara sin distinguir mayúsculas", () => {
  assert.equal(abreTeclado(elemento("input", { type: "TEXT" })), true);
  assert.equal(abreTeclado(elemento("input", { type: "Email" })), true);
});

test("cada tipo de input con teclado lo abre", () => {
  for (const type of TIPOS_CON_TECLADO) assert.equal(abreTeclado(elemento("input", { type })), true, type);
});

test("radios, casillas, botones, selectores de fecha y demás inputs no abren teclado", () => {
  for (const type of TIPOS_SIN_TECLADO) assert.equal(abreTeclado(elemento("input", { type })), false, type);
});

test("un textarea abre teclado salvo si es de solo lectura o está deshabilitado", () => {
  assert.equal(abreTeclado(elemento("textarea")), true, "normal");
  assert.equal(abreTeclado(elemento("textarea", { readOnly: true })), false, "readOnly");
  assert.equal(abreTeclado(elemento("textarea", { disabled: true })), false, "disabled");
});

test("un input de texto de solo lectura o deshabilitado no abre teclado", () => {
  assert.equal(abreTeclado(elemento("input", { type: "text", readOnly: true })), false, "readOnly");
  assert.equal(abreTeclado(elemento("input", { type: "text", disabled: true })), false, "disabled");
});

test("un <fieldset disabled> deshabilita sus campos aunque ellos no tengan el atributo", () => {
  // El onboarding deshabilita el fieldset mientras guarda (completar-perfil.tsx, onboarding-options.tsx).
  assert.equal(abreTeclado(elemento("input", { type: "email", disabled: true })), false, "input");
  assert.equal(abreTeclado(elemento("textarea", { disabled: true })), false, "textarea");
});

test("inputmode=none no abre teclado en input, textarea ni contenteditable", () => {
  assert.equal(abreTeclado(elemento("input", { type: "text", inputMode: "none" })), false, "input");
  assert.equal(abreTeclado(elemento("input", { type: "text", inputMode: "NONE" })), false, "input en mayúsculas");
  assert.equal(abreTeclado(elemento("textarea", { inputMode: "none" })), false, "textarea");
  assert.equal(abreTeclado(elemento("div", { isContentEditable: true, inputMode: "none" })), false, "contenteditable");
});

test("otro inputmode conserva el teclado", () => {
  assert.equal(abreTeclado(elemento("input", { type: "text", inputMode: "numeric" })), true, "numeric");
  assert.equal(abreTeclado(elemento("textarea", { inputMode: "" })), true, "vacío");
});

test("contenteditable abre teclado si es editable, incluido plaintext-only o heredado", () => {
  // isContentEditable es verdadero con contenteditable="", "true", "plaintext-only" o heredado.
  assert.equal(abreTeclado(elemento("div", { isContentEditable: true })), true, "div editable");
  assert.equal(abreTeclado(elemento("span", { isContentEditable: true })), true, "hijo de un editable");
  assert.equal(abreTeclado(elemento("div", { isContentEditable: false })), false, "contenteditable=false");
  assert.equal(abreTeclado(elemento("div")), false, "div normal");
});

test("select, botón, enlace, el h1 y el aviso que el onboarding enfoca por script no abren teclado", () => {
  assert.equal(abreTeclado(elemento("select")), false, "select");
  assert.equal(abreTeclado(elemento("button", { type: "submit" })), false, "botón");
  assert.equal(abreTeclado(elemento("a")), false, "enlace");
  // completar-perfil.tsx enfoca el h1 (tabIndex -1) al cambiar de paso.
  assert.equal(abreTeclado(elemento("h1", { isContentEditable: false })), false, "h1");
  // onboarding-save-status.tsx enfoca su [role=alert].
  assert.equal(abreTeclado(elemento("p", { isContentEditable: false })), false, "alert");
  assert.equal(abreTeclado(elemento("body", { isContentEditable: false })), false, "nada enfocado");
});

test("sin elemento enfocado no hay teclado", () => {
  assert.equal(abreTeclado(null), false);
});
