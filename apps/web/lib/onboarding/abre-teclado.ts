/**
 * Decide si el elemento enfocado abre el teclado en pantalla.
 *
 * El ajuste de foco del onboarding (components/onboarding/onboarding-shell.tsx)
 * mueve el scroll de la pregunta cuando baja la altura visible, para que el
 * teclado no tape el campo. Un radio, una casilla, un botón o un select no abren
 * teclado: moverlos desplazaba la pregunta sin que nadie lo pidiera.
 *
 * Trabaja sobre una interfaz estructural para poder probarse sin DOM: el
 * componente solo le pasa `document.activeElement`.
 */
export interface ElementoEnfocado {
  localName: string;
  type?: string;
  readOnly?: boolean;
  inputMode?: string;
  isContentEditable?: boolean;
  matches(selector: string): boolean;
}

/** Tipos de input que muestran un teclado de texto, número, teléfono o correo. */
const TIPOS_CON_TECLADO: ReadonlySet<string> = new Set([
  "text", "email", "number", "search", "tel", "url", "password",
]);

export function abreTeclado(el: ElementoEnfocado | null): boolean {
  if (!el) return false;
  // `:disabled` también cubre el `<fieldset disabled>` que el onboarding pone mientras guarda.
  if (el.readOnly === true || (el.inputMode ?? "").toLowerCase() === "none" || el.matches(":disabled")) return false;
  // Un input sin atributo type es de texto.
  if (el.localName === "input") return TIPOS_CON_TECLADO.has((el.type || "text").toLowerCase());
  if (el.localName === "textarea") return true;
  // Cubre contenteditable="", "true", "plaintext-only" y el heredado de un ancestro.
  return el.isContentEditable === true;
}
