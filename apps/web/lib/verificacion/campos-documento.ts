/**
 * Los campos de un documento de identidad, validados en nuestro codigo.
 * Logica pura: sin red, sin Supabase y sin entorno.
 *
 * Entra el texto que leyo un lector de documentos (OCR) y sale un INDICADOR
 * ('valida', 'invalida', 'ilegible', 'coincide', 'parcial', 'no'), nunca el
 * valor. Es a proposito: el Aviso de Privacidad v2.2 dice que VICINO no recaba
 * la CURP (§4.5), y lo que se guarde de una INE tiene que poder fugarse sin
 * hacer dano. Los valores solo existen aqui, en memoria, mientras se comparan.
 *
 * NINGUNO DECIDE SOLO. El digito verificador de la CURP y los digitos de
 * control de la zona de lectura mecanica atrapan la mayoria de los errores de
 * un caracter, no todos: la posicion 9 de la CURP pesa 10, asi que cualquier
 * cambio en ella pasa (lo fija una prueba), y hay otras combinaciones de peso y
 * diferencia que tampoco se ven. Un lector que se equivoca de forma plausible,
 * o que inventa, puede producir un valor que pase todo. Esto le dice a una
 * persona donde mirar; nunca aprueba ni rechaza.
 *
 * Todavia no tiene llamadores: no esta conectado a la accion de verificacion.
 * El plan esta en openspec/changes/2026-11-07-ocr-verificacion/.
 */

export type EstadoDeCampo = "valida" | "invalida" | "ilegible";
export type EstadoDeCotejo = "coincide" | "parcial" | "no" | "ilegible";
export type EstadoDeMayoria = "si" | "no" | "no_determinable";

/** Con lo que el lector marca un caracter que no pudo leer. Un campo que lo trae es ilegible. */
export const CARACTER_ILEGIBLE = "?";

/** Mas largo que esto no es un campo de una credencial: es otra cosa, o basura. */
const MAX_LARGO_CAMPO = 120;

/** Una credencial del INE vale diez anios desde que se emite. */
export const MAX_ANIOS_DE_VIGENCIA = 10;

type Fecha = { readonly anio: number; readonly mes: number; readonly dia: number };

/** Mayusculas, sin espacios y en NFC; null si no hay nada que leer. */
function textoCompacto(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > MAX_LARGO_CAMPO) return null;
  const compacto = valor.normalize("NFC").toUpperCase().replace(/\s+/g, "");
  return compacto === "" || compacto.includes(CARACTER_ILEGIBLE) ? null : compacto;
}

function fechaExistente(anio: number, mes: number, dia: number): Fecha | null {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (mes < 1 || mes > 12 || dia < 1) return null;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return dia <= ultimoDia ? { anio, mes, dia } : null;
}

function compararFechas(a: Fecha, b: Fecha): number {
  return a.anio - b.anio || a.mes - b.mes || a.dia - b.dia;
}

// Se crea al primer uso y no al importar: un entorno sin datos de zonas
// horarias lanzaria al cargar el modulo, no al validar.
let calendarioMexico: Intl.DateTimeFormat | null = null;

/**
 * La fecha de ese instante en la Ciudad de Mexico. Un `hoy` invalido es un
 * error de quien llama, no del documento: se lanza en vez de inventar un
 * indicador.
 */
function fechaEnMexico(instante: Date): Fecha {
  if (!(instante instanceof Date) || !Number.isFinite(instante.getTime())) {
    throw new RangeError("campos-documento: `hoy` tiene que ser una fecha valida");
  }
  calendarioMexico ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = calendarioMexico.formatToParts(instante);
  const parte = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const fecha = fechaExistente(parte("year"), parte("month"), parte("day"));
  if (fecha === null) throw new RangeError("campos-documento: no se pudo leer la fecha de `hoy`");
  return fecha;
}

/** El anio en curso en la Ciudad de Mexico, para validarVigencia. */
export function anioEnMexico(hoy: Date): number {
  return fechaEnMexico(hoy).anio;
}

// --------------------------------------------------------------------------
// CURP
// --------------------------------------------------------------------------

/**
 * El orden del diccionario del digito verificador: 0-9 valen 0..9, A=10 ...
 * N=23, Ñ=24, O=25 ... Z=36. La Ñ ocupa su sitio aunque RENAPO la sustituye
 * por X en la CURP: corre una posicion el valor de todas las letras de la O a
 * la Z, y sin ella el digito sale mal.
 */
const DICCIONARIO_CURP = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

/** Claves de entidad de nacimiento de la CURP; NE = nacido en el extranjero. */
const ENTIDADES_CURP: ReadonlySet<string> = new Set([
  "AS", "BC", "BS", "CC", "CL", "CM", "CS", "CH", "DF", "DG", "GT", "GR", "HG",
  "JC", "MC", "MN", "MS", "NT", "NL", "OC", "PL", "QT", "QR", "SP", "SL", "SR",
  "TC", "TS", "TL", "VZ", "YN", "ZS", "NE",
]);

/**
 * 4 letras (la segunda, vocal o X) + nacimiento AAMMDD + sexo H/M/X + entidad
 * + 3 consonantes (o X) + diferenciador + digito verificador. El diferenciador
 * (posicion 17) es un DIGITO para quien nacio antes de 2000 y una LETRA para
 * quien nacio despues: es lo unico que da el siglo de la fecha. Sin Ñ: RENAPO
 * la cambia por X.
 */
const FORMA_CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/;

/**
 * Primitiva del algoritmo, exportada para las pruebas: el digito verificador
 * que corresponde a los primeros 17 caracteres, o null si alguno no esta en el
 * diccionario. La posicion i (de 1 a 17) pesa 19 - i y el digito es
 * (10 - suma mod 10) mod 10.
 */
export function digitoVerificadorCurp(primeros17: string): number | null {
  if (primeros17.length !== 17) return null;
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    const valor = DICCIONARIO_CURP.indexOf(primeros17.charAt(i));
    if (valor < 0) return null;
    suma += valor * (18 - i);
  }
  return (10 - (suma % 10)) % 10;
}

/** El diferenciador (posicion 17) es un digito: la fecha es del siglo XX. */
function sigloPorDigito(curp: string): boolean {
  return /\d/.test(curp.charAt(16));
}

function nacimientoDeLaCurp(curp: string): Fecha | null {
  const siglo = sigloPorDigito(curp) ? 1900 : 2000;
  return fechaExistente(siglo + Number(curp.slice(4, 6)), Number(curp.slice(6, 8)), Number(curp.slice(8, 10)));
}

/** La CURP normalizada si es valida, o null. Interna: el valor no sale de este archivo. */
function curpValida(valor: unknown, hoy?: Date): string | null {
  const curp = textoCompacto(valor);
  if (curp === null || !FORMA_CURP.test(curp) || !ENTIDADES_CURP.has(curp.slice(11, 13))) return null;
  const nacimiento = nacimientoDeLaCurp(curp);
  if (nacimiento === null) return null;
  // Un DIGITO del diferenciador leido como LETRA pasa la forma y, con peso 2,
  // a veces tambien el digito verificador (no ve los pares cuya diferencia de
  // valor es multiplo de 5): la fecha salta cien anios hacia adelante y, salvo
  // para quien tiene cien o mas, cae en el futuro. Eso lo delata aqui. La
  // confusion contraria, una LETRA leida como DIGITO, manda la fecha cien anios
  // al pasado y esta comprobacion no la ve: la cubre esMayorDeEdad.
  if (hoy !== undefined && compararFechas(nacimiento, fechaEnMexico(hoy)) > 0) return null;
  return digitoVerificadorCurp(curp.slice(0, 17)) === Number(curp.charAt(17)) ? curp : null;
}

/**
 * Forma, entidad, fecha que exista (con el siglo de la posicion 17) y digito
 * verificador. Con `hoy`, ademas, un nacimiento posterior a hoy es invalido.
 */
export function validarCurp(valor: string | null | undefined, opciones: { readonly hoy?: Date } = {}): EstadoDeCampo {
  if (textoCompacto(valor) === null) return "ilegible";
  return curpValida(valor, opciones.hoy) === null ? "invalida" : "valida";
}

const MAYORIA_DE_EDAD = 18;

/**
 * Con el siglo sacado de un digito, desde esta edad la fecha deja de ser
 * creible: es la firma de una letra de la posicion 17 leida como digito.
 */
const EDAD_QUE_DELATA_EL_SIGLO = 100;

/**
 * ¿Cumplio `anios` en la fecha `hoy`? Comparar tuplas resuelve solo el 29 de
 * febrero: en un anio no bisiesto el cumpleanios llega el 1 de marzo.
 */
function cumplioAnios(nacimiento: Fecha, anios: number, hoy: Fecha): boolean {
  return compararFechas(hoy, { anio: nacimiento.anio + anios, mes: nacimiento.mes, dia: nacimiento.dia }) >= 0;
}

/**
 * 'si' si la persona cumplio 18 anios en la fecha de hoy de la Ciudad de
 * Mexico (el Aviso §16 exige mayoria de edad). Sale de la fecha de la CURP,
 * el unico campo leido que trae el siglo: la fecha de nacimiento impresa en el
 * frente se deja fuera a proposito (ver ocr/tipos.ts). Sin una CURP valida no
 * se puede saber.
 *
 * Tampoco cuando el siglo sale de un DIGITO en la posicion 17 y la persona
 * tendria cien anios o mas. Lo probable no es un vendedor centenario, sino una
 * LETRA (nacido desde 2000) leida como digito: con peso 2, el digito
 * verificador no ve los pares cuya diferencia de valor es multiplo de 5 (G/6,
 * O/0, L/1, B/6, A/0, A/5...), y la fecha retrocede cien anios sin caer en el
 * futuro. Sin esto, un menor saldria 'si'. La confusion le suma exactamente
 * cien anios a la edad real, asi que el umbral la atrapa siempre; el precio es
 * que un centenario de verdad tambien lo mira una persona.
 */
export function esMayorDeEdad(curpLeida: string | null | undefined, hoy: Date): EstadoDeMayoria {
  const hoyEnMexico = fechaEnMexico(hoy);
  const curp = curpValida(curpLeida, hoy);
  const nacimiento = curp === null ? null : nacimientoDeLaCurp(curp);
  if (curp === null || nacimiento === null) return "no_determinable";
  if (sigloPorDigito(curp) && cumplioAnios(nacimiento, EDAD_QUE_DELATA_EL_SIGLO, hoyEnMexico)) {
    return "no_determinable";
  }
  return cumplioAnios(nacimiento, MAYORIA_DE_EDAD, hoyEnMexico) ? "si" : "no";
}

// --------------------------------------------------------------------------
// Clave de elector
// --------------------------------------------------------------------------

/**
 * 6 letras + nacimiento AAMMDD + entidad (2 digitos) + sexo + 3 digitos. No
 * tiene digito verificador publico, asi que lo unico que se puede comprobar es
 * la forma y la coherencia con la CURP.
 *
 * SUPUESTO: se admite X como sexo, igual que en la CURP. Si el INE solo emite
 * H y M en la clave, aceptar X no hace dano; exigir H/M a una credencial con X
 * diria «invalida» de un documento bueno.
 */
const FORMA_CLAVE_ELECTOR = /^[A-Z]{6}\d{8}[HMX]\d{3}$/;

/**
 * Forma de la clave y, si se da una CURP VALIDA del mismo frente, coherencia
 * de nacimiento y sexo con ella. Con la CURP ilegible o invalida no hay contra
 * que cotejar y queda solo la forma (el indicador de la CURP ya lo dice).
 *
 * `hoy` tiene que ser el mismo que recibe validarCurp, para que «CURP valida»
 * signifique lo mismo en los dos indicadores: con el, una CURP de nacimiento
 * futuro es invalida y no se coteja.
 */
export function validarClaveElector(
  valor: string | null | undefined,
  curpDelFrente?: string | null,
  opciones: { readonly hoy?: Date } = {},
): EstadoDeCampo {
  const clave = textoCompacto(valor);
  if (clave === null) return "ilegible";
  if (!FORMA_CLAVE_ELECTOR.test(clave)) return "invalida";
  // La clave no trae siglo: basta con que el dia exista en algun anio (2000 es
  // bisiesto, asi que el 29 de febrero pasa).
  if (fechaExistente(2000, Number(clave.slice(8, 10)), Number(clave.slice(10, 12))) === null) return "invalida";
  const curp = curpValida(curpDelFrente, opciones.hoy);
  if (curp === null) return "valida";
  if (clave.slice(6, 12) !== curp.slice(4, 10)) return "invalida";
  const sexoDeLaClave = clave.charAt(14);
  const sexoDeLaCurp = curp.charAt(10);
  if (sexoDeLaClave === "X" || sexoDeLaCurp === "X") return "valida";
  return sexoDeLaClave === sexoDeLaCurp ? "valida" : "invalida";
}

// --------------------------------------------------------------------------
// Vigencia
// --------------------------------------------------------------------------

function aniosDeLaVigencia(valor: unknown): number[] | null {
  if (typeof valor !== "string" || valor.length > MAX_LARGO_CAMPO || valor.includes(CARACTER_ILEGIBLE)) return null;
  const anios = valor
    .split(/\D+/)
    .filter((tramo) => tramo.length === 4)
    .map(Number);
  return anios.length > 0 ? anios : null;
}

/**
 * «2023 - 2033» o «2033»: vale hasta el 31 de diciembre del ultimo anio. Es
 * invalida si ese anio ya paso, si el periodo es imposible (al reves o de mas
 * de diez anios) o si termina mas lejos de lo que puede durar una credencial
 * emitida hoy. `anioActual` llega por parametro para poder probarlo.
 */
export function validarVigencia(valor: string | null | undefined, anioActual: number): EstadoDeCampo {
  if (!Number.isInteger(anioActual)) {
    throw new RangeError("validarVigencia: anioActual tiene que ser un anio entero");
  }
  const anios = aniosDeLaVigencia(valor);
  const inicial = anios?.[0];
  const final = anios?.at(-1);
  if (inicial === undefined || final === undefined) return "ilegible";
  if (final < inicial || final - inicial > MAX_ANIOS_DE_VIGENCIA) return "invalida";
  if (final > anioActual + MAX_ANIOS_DE_VIGENCIA) return "invalida";
  return final >= anioActual ? "valida" : "invalida";
}

// --------------------------------------------------------------------------
// Zona de lectura mecanica (reverso de la INE)
// --------------------------------------------------------------------------

/*
 * SUPUESTO DE FORMATO. En el repo no hay ninguna muestra ni documentacion del
 * INE sobre esto; esta escrito con el estandar y hay que validarlo con
 * credenciales de muestra antes de usar el indicador para nada.
 *
 * Se asume que el reverso de la credencial para votar lleva una zona de tres
 * lineas de 30 caracteres en el formato TD1 de ICAO 9303 (parte 5):
 *
 *   linea 1: "ID" + "MEX" + numero del documento (9) + su digito de control
 *            + datos opcionales (15)
 *   linea 2: nacimiento AAMMDD + control + sexo + vencimiento AAMMDD +
 *            control + nacionalidad "MEX" + opcionales (11) + control compuesto
 *   linea 3: apellidos << nombres, con '<' de relleno
 *
 * Digitos de control: pesos 7, 3, 1 repetidos; 0-9 valen 0..9, A-Z valen
 * 10..35 y '<' vale 0; el digito es la suma modulo 10. El compuesto cubre la
 * linea 1 desde la posicion 6, nacimiento y vencimiento con sus controles y
 * los opcionales de la linea 2.
 *
 * El sexo puede venir en espanol (H/M) o como en ICAO (M/F), y entonces la M
 * es ambigua: por eso no se coteja con la CURP. Tambien se asume que el
 * vencimiento cae en el ultimo anio de VIGENCIA del frente; solo se comparan
 * los dos digitos del anio.
 */

const LARGO_DE_LINEA_TD1 = 30;
const FORMA_DE_LINEA_MRZ = /^[A-Z0-9<]{30}$/;
const PESOS_MRZ = [7, 3, 1] as const;

/** Primitiva del algoritmo 7-3-1, exportada para las pruebas; null si hay un caracter que no admite. */
export function digitoDeControlMrz(campo: string): number | null {
  let suma = 0;
  for (let i = 0; i < campo.length; i++) {
    const c = campo.charAt(i);
    const valor = c === "<" ? 0 : /\d/.test(c) ? Number(c) : /[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : -1;
    if (valor < 0) return null;
    suma += valor * (PESOS_MRZ[i % 3] ?? 0);
  }
  return suma % 10;
}

type ZonaIne = { readonly nacimiento: string; readonly vencimiento: string; readonly nombres: string };
type LecturaDeZona = { readonly estado: EstadoDeCampo; readonly zona: ZonaIne | null };

function lineasDeLaZona(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || valor.length > 6) return null;
  const lineas: string[] = [];
  for (const linea of valor) {
    if (typeof linea !== "string" || linea.length > MAX_LARGO_CAMPO) return null;
    const limpia = linea.normalize("NFC").toUpperCase().replace(/\s+/g, "");
    if (limpia !== "") lineas.push(limpia);
  }
  return lineas;
}

function esFechaAammdd(texto: string): boolean {
  return /^\d{6}$/.test(texto) && fechaExistente(2000, Number(texto.slice(2, 4)), Number(texto.slice(4, 6))) !== null;
}

function controlCuadra(campo: string, digito: string): boolean {
  return /^\d$/.test(digito) && digitoDeControlMrz(campo) === Number(digito);
}

function leerZonaIne(valor: unknown): LecturaDeZona {
  const lineas = lineasDeLaZona(valor);
  if (
    lineas === null ||
    lineas.length !== 3 ||
    lineas.some((l) => l.includes(CARACTER_ILEGIBLE) || l.length !== LARGO_DE_LINEA_TD1)
  ) {
    return { estado: "ilegible", zona: null };
  }
  const [l1 = "", l2 = "", l3 = ""] = lineas;
  const invalida: LecturaDeZona = { estado: "invalida", zona: null };
  if (![l1, l2, l3].every((l) => FORMA_DE_LINEA_MRZ.test(l))) return invalida;
  if (!l1.startsWith("IDMEX") || l2.slice(15, 18) !== "MEX" || !/^[MFHX<]$/.test(l2.charAt(7))) return invalida;
  if (!/^[A-Z<]+$/.test(l3) || !/[A-Z]/.test(l3)) return invalida;
  const nacimiento = l2.slice(0, 6);
  const vencimiento = l2.slice(8, 14);
  if (!esFechaAammdd(nacimiento) || !esFechaAammdd(vencimiento)) return invalida;
  const compuesto = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);
  const cuadran =
    controlCuadra(l1.slice(5, 14), l1.charAt(14)) &&
    controlCuadra(nacimiento, l2.charAt(6)) &&
    controlCuadra(vencimiento, l2.charAt(14)) &&
    controlCuadra(compuesto, l2.charAt(29));
  if (!cuadran) return invalida;
  // Una linea de nombres que no termina en relleno se corto en el caracter 30:
  // su ultima palabra puede venir a medias y no se usa para cotejar.
  const nombres = l3.endsWith("<") ? l3 : l3.replace(/[A-Z]+$/, "");
  return { estado: "valida", zona: { nacimiento, vencimiento, nombres } };
}

/** Las tres lineas del reverso: forma, prefijo IDMEX, fechas y los cuatro digitos de control. */
export function validarMrzIne(lineas: readonly string[] | null | undefined): EstadoDeCampo {
  return leerZonaIne(lineas).estado;
}

// --------------------------------------------------------------------------
// Nombre
// --------------------------------------------------------------------------

/** Se ignoran al cotejar: aparecen o no segun quien escriba el nombre. */
const PARTICULAS_DEL_NOMBRE: ReadonlySet<string> = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

/** Palabras del nombre sin acentos (la Ñ queda como N, igual que en la zona de lectura), en mayusculas. */
function palabrasDelNombre(valor: unknown): ReadonlySet<string> {
  if (typeof valor !== "string" || valor.length > MAX_LARGO_CAMPO) return new Set();
  const palabras = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p !== "" && !PARTICULAS_DEL_NOMBRE.has(p));
  return new Set(palabras);
}

/**
 * Nombre leido contra nombre de la cuenta, sin acentos, mayusculas, espacios
 * ni orden: 'coincide' si son las mismas palabras; 'parcial' si uno contiene
 * al otro (falta un apellido o un segundo nombre); 'no' en cualquier otro
 * caso. Sin tolerancia a letras mal leidas: una letra cambiada da 'no' o
 * 'parcial', y eso solo pide que una persona mire la foto.
 */
export function cotejarNombre(leido: string | null | undefined, registrado: string | null | undefined): EstadoDeCotejo {
  if (typeof leido === "string" && leido.includes(CARACTER_ILEGIBLE)) return "ilegible";
  const delDocumento = palabrasDelNombre(leido);
  const deLaCuenta = palabrasDelNombre(registrado);
  if (delDocumento.size === 0 || deLaCuenta.size === 0) return "ilegible";
  const documentoEnCuenta = [...delDocumento].every((p) => deLaCuenta.has(p));
  const cuentaEnDocumento = [...deLaCuenta].every((p) => delDocumento.has(p));
  if (documentoEnCuenta && cuentaEnDocumento) return "coincide";
  return documentoEnCuenta || cuentaEnDocumento ? "parcial" : "no";
}

// --------------------------------------------------------------------------
// Frente contra reverso
// --------------------------------------------------------------------------

export type FrenteParaCotejar = {
  readonly curp?: string | null;
  readonly vigencia?: string | null;
  readonly nombre?: string | null;
};

/**
 * ¿El reverso es del mismo documento que el frente? Con la zona de lectura
 * valida se comparan hasta tres cosas: el nacimiento de la CURP, el anio de
 * vencimiento contra la VIGENCIA y el nombre. 'no' si alguna no cuadra;
 * 'coincide' si cuadran las tres; 'parcial' si cuadran las que se pudieron
 * comparar pero faltaba alguna; 'ilegible' si no se pudo comparar nada.
 */
export function cotejarFrenteConReverso(
  frente: FrenteParaCotejar,
  mrz: readonly string[] | null | undefined,
): EstadoDeCotejo {
  const { zona } = leerZonaIne(mrz);
  if (zona === null) return "ilegible";
  const pruebas: boolean[] = [];
  const curp = curpValida(frente.curp);
  if (curp !== null) pruebas.push(curp.slice(4, 10) === zona.nacimiento);
  const anioFinal = aniosDeLaVigencia(frente.vigencia)?.at(-1);
  if (anioFinal !== undefined) {
    pruebas.push(String(anioFinal % 100).padStart(2, "0") === zona.vencimiento.slice(0, 2));
  }
  const nombre = cotejarNombre(frente.nombre, zona.nombres);
  if (nombre !== "ilegible") pruebas.push(nombre !== "no");
  if (pruebas.length === 0) return "ilegible";
  if (pruebas.includes(false)) return "no";
  return pruebas.length === 3 ? "coincide" : "parcial";
}
