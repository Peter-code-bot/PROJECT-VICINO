/**
 * Documentos SINTETICOS para las pruebas de lib/verificacion.
 *
 * Nada de esto es de una persona: en la CURP, las letras que salen del nombre
 * van como X («sin dato» en las reglas de RENAPO) y los numeros de la
 * credencial son ceros. El repo es publico: no metas aqui, ni en las pruebas,
 * la CURP, la clave de elector o la zona de lectura de nadie, ni siquiera
 * «para probar».
 *
 * Los digitos se calculan con una implementacion PROPIA de este archivo, no
 * con la de campos-documento.ts: si las dos compartieran un error, la prueba
 * no lo veria. Las pruebas ademas fijan vectores calculados aparte.
 */

const DICCIONARIO_CURP = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

/** Le pone su digito verificador a los primeros 17 caracteres de una CURP. */
export function curpSintetica(primeros17: string): string {
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += DICCIONARIO_CURP.indexOf(primeros17.charAt(i)) * (18 - i);
  return primeros17 + String((10 - (suma % 10)) % 10);
}

/** Cambia el caracter de la posicion `posicion` (contando desde 1). */
export function conCaracter(texto: string, posicion: number, caracter: string): string {
  return texto.slice(0, posicion - 1) + caracter + texto.slice(posicion);
}

/** Digito de control 7-3-1 de ICAO 9303, como texto. */
export function controlMrz(campo: string): string {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < campo.length; i++) {
    const c = campo.charAt(i);
    const valor = c === "<" ? 0 : c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55;
    suma += valor * (pesos[i % 3] ?? 0);
  }
  return String(suma % 10);
}

/**
 * Una zona de lectura TD1 con el formato que asume campos-documento.ts y los
 * cuatro digitos de control bien puestos. Por defecto: nacimiento 990115,
 * vencimiento 331231 y nombres PRUEBA SINTETICA / PERSONA.
 */
export function zonaSintetica(
  opciones: { nacimiento?: string; vencimiento?: string; nombres?: string; prefijo?: string } = {},
): string[] {
  const {
    nacimiento = "990115",
    vencimiento = "331231",
    nombres = "PRUEBA<SINTETICA<<PERSONA",
    prefijo = "IDMEX",
  } = opciones;
  const documento = "000000001";
  const linea1 = `${prefijo}${documento}${controlMrz(documento)}<<${"0".repeat(13)}`;
  const parcial = `${nacimiento}${controlMrz(nacimiento)}H${vencimiento}${controlMrz(vencimiento)}MEX${"<".repeat(11)}`;
  const compuesto = linea1.slice(5, 30) + parcial.slice(0, 7) + parcial.slice(8, 15) + parcial.slice(18, 29);
  return [linea1, parcial + controlMrz(compuesto), nombres.padEnd(30, "<").slice(0, 30)];
}
