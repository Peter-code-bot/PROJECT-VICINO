/**
 * Casos de los validadores de campos de la INE.
 *
 * Todo con DATOS SINTETICOS (lib/pruebas/documentos-sinteticos.ts): nada de
 * esto es de una persona. Los generadores calculan los digitos con su propia
 * implementacion, no con la del modulo, y aqui se fijan ademas vectores
 * calculados aparte (a mano y con otra implementacion) para que un error
 * compartido no pase.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  anioEnMexico,
  cotejarFrenteConReverso,
  cotejarNombre,
  digitoDeControlMrz,
  digitoVerificadorCurp,
  esMayorDeEdad,
  validarClaveElector,
  validarCurp,
  validarMrzIne,
  validarVigencia,
} from "./campos-documento";
import { conCaracter, curpSintetica, zonaSintetica } from "../pruebas/documentos-sinteticos";

const DICCIONARIO = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

// Vectores calculados aparte. El primero, a mano: con X=34, H=17, P=26 y L=21
// la suma ponderada da 3405, y (10 - 5) mod 10 = 5.
const CURP_1999 = "XXXX990115HPLXXX05";
const CURP_2001 = "XEXX010101MNEXXXA4"; // posicion 17 letra: nacio en 2001; entidad NE
const CURP_SEXO_X = "XAXX850630XDFXXX92";

const HOY = new Date("2026-11-07T18:00:00Z");

const PERMITIDOS = new Set(["valida", "invalida", "ilegible", "coincide", "parcial", "no", "si", "no_determinable"]);

// --------------------------------------------------------------------------
// CURP
// --------------------------------------------------------------------------

test("CURP: los vectores calculados aparte son validos", () => {
  for (const curp of [CURP_1999, CURP_2001, CURP_SEXO_X]) {
    assert.equal(validarCurp(curp), "valida", curp);
    assert.equal(curpSintetica(curp.slice(0, 17)), curp, "el generador de la prueba coincide con el vector");
  }
  assert.equal(digitoVerificadorCurp(CURP_1999.slice(0, 17)), 5);
});

test("CURP: el diccionario pone la Ñ en el 24 y corre de la O a la Z", () => {
  // Con solo cambiar la letra del primer caracter, el digito cambia segun su
  // valor por 18. N=23, Ñ=24, O=25, Z=36.
  const base = "XXXX990115HPLXXX0";
  const digito = (letra: string) => digitoVerificadorCurp(letra + base.slice(1));
  const esperado = (valor: number) => (10 - ((valor * 18 + 3405 - 34 * 18) % 10)) % 10;
  assert.equal(digito("N"), esperado(23));
  assert.equal(digito("Ñ"), esperado(24));
  assert.equal(digito("O"), esperado(25));
  assert.equal(digito("Z"), esperado(36));
  assert.equal(digitoVerificadorCurp("corta"), null);
  assert.equal(digitoVerificadorCurp("XXXX990115HPLXX#0"), null);
});

test("CURP: minusculas y espacios se normalizan; vacio o con '?' es ilegible", () => {
  assert.equal(validarCurp(`  ${CURP_1999.toLowerCase().slice(0, 9)} ${CURP_1999.toLowerCase().slice(9)} `), "valida");
  assert.equal(validarCurp(null), "ilegible");
  assert.equal(validarCurp(undefined), "ilegible");
  assert.equal(validarCurp("   "), "ilegible");
  assert.equal(validarCurp(conCaracter(CURP_1999, 7, "?")), "ilegible");
});

test("CURP: un caracter cambiado se detecta (posiciones con peso que si lo ve)", () => {
  assert.equal(validarCurp(conCaracter(CURP_1999, 1, "Y")), "invalida", "pos 1, peso 18, X->Y");
  assert.equal(validarCurp(conCaracter(CURP_1999, 10, "6")), "invalida", "pos 10, peso 9, dia 15->16");
  assert.equal(validarCurp(conCaracter(CURP_1999, 16, "Z")), "invalida", "pos 16, peso 3, X->Z");
  assert.equal(validarCurp(conCaracter(CURP_1999, 18, "6")), "invalida", "el propio digito");
});

test("CURP: un cambio en la posicion 9 NO lo ve el digito verificador (pesa 10)", () => {
  // DOCUMENTADO A PROPOSITO, para que nadie use este indicador como decision
  // unica: el dia 15 leido como 25 da una CURP que pasa todo.
  const cambiada = conCaracter(CURP_1999, 9, "2");
  assert.notEqual(cambiada, CURP_1999);
  assert.equal(validarCurp(cambiada), "valida");
});

test("CURP: todo cambio de un caracter que pasa se explica por peso x diferencia multiplo de 10", () => {
  const base = CURP_1999.slice(0, 17);
  const posicionesCiegas = new Set<number>();
  for (let i = 0; i < 17; i++) {
    for (const caracter of DICCIONARIO) {
      const original = base.charAt(i);
      if (caracter === original) continue;
      const cambiada = conCaracter(CURP_1999, i + 1, caracter);
      if (validarCurp(cambiada) !== "valida") continue;
      const diferencia = DICCIONARIO.indexOf(caracter) - DICCIONARIO.indexOf(original);
      assert.equal(Math.abs((18 - i) * diferencia) % 10, 0, `posicion ${i + 1}: ${original} -> ${caracter}`);
      posicionesCiegas.add(i + 1);
    }
  }
  assert.ok(posicionesCiegas.has(9), "la posicion 9 es ciega");
});

test("CURP: forma, entidad, fecha y siglo de la posicion 17", () => {
  assert.equal(validarCurp(curpSintetica("XXXX990115HZZXXX0")), "invalida", "entidad que no existe");
  assert.equal(validarCurp(curpSintetica("XBXX990115HPLXXX0")), "invalida", "la segunda no es vocal ni X");
  assert.equal(validarCurp(curpSintetica("XXXX990115HPLAXX0")), "invalida", "vocal donde va consonante");
  assert.equal(validarCurp(curpSintetica("XXÑX990115HPLXXX0")), "invalida", "RENAPO cambia la Ñ por X");
  assert.equal(validarCurp(curpSintetica("XXXX990230HPLXXX0")), "invalida", "30 de febrero");
  assert.equal(validarCurp(curpSintetica("XXXX990229HPLXXX0")), "invalida", "1999 no es bisiesto");
  assert.equal(validarCurp(curpSintetica("XXXX000229HPLXXXA")), "valida", "2000 si (letra: siglo XXI)");
  assert.equal(validarCurp(curpSintetica("XXXX000229HPLXXX0")), "invalida", "1900 no es bisiesto");
});

test("CURP: con hoy, un diferenciador leido como letra que manda el nacimiento al futuro es invalido", () => {
  const delFuturo = curpSintetica("XXXX990115HPLXXXA"); // 2099
  assert.equal(validarCurp(delFuturo), "valida", "sin hoy solo se mira el calendario");
  assert.equal(validarCurp(delFuturo, { hoy: HOY }), "invalida");
  assert.equal(validarCurp(CURP_1999, { hoy: HOY }), "valida");
  assert.throws(() => validarCurp(CURP_1999, { hoy: new Date("no es fecha") }), RangeError);
});

// --------------------------------------------------------------------------
// Mayoria de edad
// --------------------------------------------------------------------------

test("mayoria de edad: sale de la CURP, en la fecha de la Ciudad de Mexico", () => {
  assert.equal(esMayorDeEdad(CURP_1999, HOY), "si");
  const cumple18El8 = curpSintetica("XXXX081108HPLXXXA");
  assert.equal(esMayorDeEdad(cumple18El8, new Date("2026-11-07T23:00:00Z")), "no");
  // A las 03:00 UTC del 8 de noviembre en la Ciudad de Mexico todavia es el 7.
  assert.equal(esMayorDeEdad(cumple18El8, new Date("2026-11-08T03:00:00Z")), "no");
  assert.equal(esMayorDeEdad(cumple18El8, new Date("2026-11-08T12:00:00Z")), "si");
});

test("mayoria de edad: el 29 de febrero llega el 1 de marzo en anio no bisiesto", () => {
  const bisiesto = curpSintetica("XXXX080229MPLXXXA");
  assert.equal(esMayorDeEdad(bisiesto, new Date("2026-02-28T18:00:00Z")), "no");
  assert.equal(esMayorDeEdad(bisiesto, new Date("2026-03-01T18:00:00Z")), "si");
});

test("mayoria de edad: sin una CURP valida no se puede saber", () => {
  assert.equal(esMayorDeEdad(null, HOY), "no_determinable");
  assert.equal(esMayorDeEdad(conCaracter(CURP_1999, 1, "Y"), HOY), "no_determinable");
  assert.equal(esMayorDeEdad(curpSintetica("XXXX990115HPLXXXA"), HOY), "no_determinable", "nacimiento en 2099");
  assert.throws(() => esMayorDeEdad(CURP_1999, new Date(Number.NaN)), RangeError);
});

test("mayoria de edad: una LETRA de la posicion 17 leida como DIGITO no hace mayor a un menor", () => {
  // Con peso 2, el digito verificador no ve los pares cuya diferencia de valor
  // es multiplo de 5, y el siglo pasa de 2000 a 1900: el nacimiento queda en
  // el pasado y la comprobacion del futuro no lo ve. Menores sinteticos
  // nacidos en 2009 y 2010.
  const confusiones: ReadonlyArray<readonly [string, string, string]> = [
    ["100505", "G", "6"],
    ["100505", "O", "0"],
    ["091231", "L", "1"],
    ["090630", "B", "6"],
  ];
  for (const [nacimiento, letra, digito] of confusiones) {
    const real = curpSintetica(`XXXX${nacimiento}HPLXXX${letra}`);
    const leida = conCaracter(real, 17, digito);
    assert.equal(esMayorDeEdad(real, HOY), "no", `${letra}: la CURP real es de un menor`);
    assert.equal(validarCurp(leida, { hoy: HOY }), "valida", `${letra}->${digito}: el digito verificador no lo ve`);
    assert.equal(esMayorDeEdad(leida, HOY), "no_determinable", `${letra}->${digito}`);
  }
});

test("mayoria de edad: con el siglo de un digito, cien anios o mas no son creibles", () => {
  // El precio, a proposito: un centenario de verdad tambien sale
  // 'no_determinable', y lo mira una persona.
  assert.equal(esMayorDeEdad(curpSintetica("XXXX261108HPLXXX0"), HOY), "si", "99 anios: cumple cien manana");
  assert.equal(esMayorDeEdad(curpSintetica("XXXX261107HPLXXX0"), HOY), "no_determinable", "cumple cien hoy");
  assert.equal(esMayorDeEdad(curpSintetica("XXXX200101HPLXXX0"), HOY), "no_determinable", "106 anios");
  // Con letra (siglo XXI) no hace falta el limite: nadie nacido desde 2000 tiene cien.
  assert.equal(esMayorDeEdad(curpSintetica("XXXX000101HPLXXXA"), HOY), "si");
});

// --------------------------------------------------------------------------
// Clave de elector
// --------------------------------------------------------------------------

const CLAVE = "XXXXXX99011521H000"; // nacimiento 990115, entidad 21, sexo H

test("clave de elector: forma valida, con y sin CURP coherente", () => {
  assert.equal(validarClaveElector(CLAVE), "valida");
  assert.equal(validarClaveElector(CLAVE, CURP_1999), "valida");
  assert.equal(validarClaveElector(` ${CLAVE.toLowerCase()} `, CURP_1999), "valida");
  assert.equal(validarClaveElector("XXXXXX00022921M000"), "valida", "29 de febrero sin siglo");
});

test("clave de elector: incoherente con la CURP en fecha o sexo es invalida", () => {
  assert.equal(validarClaveElector("XXXXXX99011621H000", CURP_1999), "invalida", "otro dia");
  assert.equal(validarClaveElector("XXXXXX99011621H000"), "valida", "sin CURP solo cuenta la forma");
  assert.equal(validarClaveElector("XXXXXX99011521M000", CURP_1999), "invalida", "otro sexo");
  assert.equal(validarClaveElector("XXXXXX85063009H000", CURP_SEXO_X), "valida", "con X en la CURP no se coteja el sexo");
  assert.equal(validarClaveElector("XXXXXX99011621H000", conCaracter(CURP_1999, 1, "Y")), "valida", "CURP invalida: no hay con que cotejar");
});

test("clave de elector: con hoy, una CURP de nacimiento futuro no sirve para cotejar, igual que en su indicador", () => {
  const delFuturo = curpSintetica("XXXX990115HPLXXXA"); // 2099
  assert.equal(validarClaveElector("XXXXXX99011621H000", delFuturo), "invalida", "sin hoy se coteja con ella");
  assert.equal(validarClaveElector("XXXXXX99011621H000", delFuturo, { hoy: HOY }), "valida", "con hoy queda solo la forma");
  assert.equal(validarClaveElector("XXXXXX99011621H000", CURP_1999, { hoy: HOY }), "invalida", "una CURP valida se sigue cotejando");
});

test("clave de elector: forma incorrecta o ilegible", () => {
  assert.equal(validarClaveElector("XXXXXX9901152H000"), "invalida", "17 caracteres");
  assert.equal(validarClaveElector("XXXXX199011521H000"), "invalida", "digito entre las letras");
  assert.equal(validarClaveElector("XXXXXX99131521H000"), "invalida", "mes 13");
  assert.equal(validarClaveElector("XXXXXX99023021H000"), "invalida", "30 de febrero");
  assert.equal(validarClaveElector(null), "ilegible");
  assert.equal(validarClaveElector(""), "ilegible");
  assert.equal(validarClaveElector("XXXXXX9901?521H000"), "ilegible");
});

// --------------------------------------------------------------------------
// Vigencia
// --------------------------------------------------------------------------

test("vigencia: vale hasta el ultimo anio, con el anio inyectado", () => {
  assert.equal(validarVigencia("2023 - 2033", 2026), "valida");
  assert.equal(validarVigencia("VIGENCIA 2026", 2026), "valida", "el anio en curso todavia vale");
  assert.equal(validarVigencia("2016 - 2026", 2026), "valida");
  assert.equal(validarVigencia("2016 - 2026", 2027), "invalida", "el mismo texto un anio despues");
  assert.equal(validarVigencia("2015 - 2025", 2026), "invalida", "vencida");
});

test("vigencia: periodos imposibles o ilegibles", () => {
  assert.equal(validarVigencia("2033 - 2023", 2026), "invalida", "al reves");
  assert.equal(validarVigencia("2010 - 2030", 2026), "invalida", "veinte anios");
  assert.equal(validarVigencia("2040", 2026), "invalida", "mas lejos de lo que dura una credencial");
  assert.equal(validarVigencia(null, 2026), "ilegible");
  assert.equal(validarVigencia("VIGENCIA", 2026), "ilegible");
  assert.equal(validarVigencia("20?3 - 2033", 2026), "ilegible");
  assert.equal(validarVigencia("33", 2026), "ilegible", "anio de dos digitos");
  assert.throws(() => validarVigencia("2033", 2026.5), RangeError);
});

test("anioEnMexico: el 1 de enero a las 05:00 UTC todavia es el anio anterior", () => {
  assert.equal(anioEnMexico(new Date("2027-01-01T05:00:00Z")), 2026);
  assert.equal(anioEnMexico(new Date("2027-01-01T07:00:00Z")), 2027);
});

// --------------------------------------------------------------------------
// Zona de lectura mecanica
// --------------------------------------------------------------------------

test("MRZ: el algoritmo 7-3-1 da los digitos del ejemplo TD1 de ICAO 9303 (estado ficticio)", () => {
  assert.equal(digitoDeControlMrz("D23145890"), 7);
  assert.equal(digitoDeControlMrz("740812"), 2);
  assert.equal(digitoDeControlMrz("120415"), 9);
  assert.equal(digitoDeControlMrz(`D231458907${"<".repeat(15)}7408122120415${"9"}${"<".repeat(11)}`), 6);
  assert.equal(digitoDeControlMrz("abc"), null);
});

test("MRZ: una zona sintetica bien formada es valida, aunque llegue en minusculas o con espacios", () => {
  const zona = zonaSintetica();
  assert.deepEqual(zona.map((l) => l.length), [30, 30, 30]);
  assert.equal(validarMrzIne(zona), "valida");
  assert.equal(validarMrzIne(zona.map((l) => ` ${l.slice(0, 10)} ${l.slice(10).toLowerCase()} `)), "valida");
});

test("MRZ: un digito cambiado sin recalcular los controles es invalido", () => {
  const [l1 = "", l2 = "", l3 = ""] = zonaSintetica();
  assert.equal(validarMrzIne([l1, conCaracter(l2, 6, "6"), l3]), "invalida", "nacimiento");
  assert.equal(validarMrzIne([conCaracter(l1, 14, "2"), l2, l3]), "invalida", "numero del documento");
  assert.equal(validarMrzIne([l1, conCaracter(l2, 30, String((Number(l2.charAt(29)) + 1) % 10)), l3]), "invalida", "compuesto");
});

test("MRZ: otro emisor, fecha imposible o linea de nombres sin letras es invalida", () => {
  assert.equal(validarMrzIne(zonaSintetica({ prefijo: "IDUTO" })), "invalida", "no es del INE");
  assert.equal(validarMrzIne(zonaSintetica({ nacimiento: "991315" })), "invalida", "mes 13");
  assert.equal(validarMrzIne(zonaSintetica({ nombres: "" })), "invalida");
});

test("MRZ: incompleta o con caracteres que el lector no pudo leer es ilegible", () => {
  const zona = zonaSintetica();
  assert.equal(validarMrzIne(null), "ilegible");
  assert.equal(validarMrzIne(zona.slice(0, 2)), "ilegible");
  assert.equal(validarMrzIne([zona[0] ?? "", (zona[1] ?? "").slice(0, 29), zona[2] ?? ""]), "ilegible");
  assert.equal(validarMrzIne([zona[0] ?? "", conCaracter(zona[1] ?? "", 3, "?"), zona[2] ?? ""]), "ilegible");
});

// --------------------------------------------------------------------------
// Nombre
// --------------------------------------------------------------------------

test("nombre: acentos, mayusculas, espacios y orden no cuentan", () => {
  assert.equal(cotejarNombre("PERSONA PRUEBA SINTETICA", "Persona Prueba Sintética"), "coincide");
  assert.equal(cotejarNombre("SINTETICA PRUEBA PERSONA", "persona prueba sintetica"), "coincide");
  assert.equal(cotejarNombre("  PERSONA   PRUEBA\nSINTETICA ", "Persona Prueba Sintetica"), "coincide");
  assert.equal(cotejarNombre("PERSONA DE LA PRUEBA", "Persona Prueba"), "coincide", "particulas");
  assert.equal(cotejarNombre("PRUEBA<SINTETICA<<PERSONA<<<<<", "Persona Prueba Sintética"), "coincide", "como en la zona de lectura");
  assert.equal(cotejarNombre("PERSONA NUÑEZ", "Persona Nunez"), "coincide", "la Ñ vale como N");
});

test("nombre: incompleto es parcial; sin relacion es no; ilegible si falta un lado", () => {
  assert.equal(cotejarNombre("PERSONA PRUEBA SINTETICA", "Persona Prueba"), "parcial");
  assert.equal(cotejarNombre("PERSONA", "Persona Prueba Sintetica"), "parcial");
  assert.equal(cotejarNombre("OTRA GENTE DISTINTA", "Persona Prueba"), "no");
  assert.equal(cotejarNombre("PERSONA OTRAPRUEBA", "Persona Prueba"), "no", "comparten una palabra pero falta otra en cada lado");
  // Una letra mal leida no se perdona: da 'no' y una persona mira la foto.
  assert.equal(cotejarNombre("PERSONA PRUEVA", "Persona Prueba"), "no");
  assert.equal(cotejarNombre(null, "Persona Prueba"), "ilegible");
  assert.equal(cotejarNombre("PERS?NA PRUEBA", "Persona Prueba"), "ilegible");
  assert.equal(cotejarNombre("PERSONA PRUEBA", ""), "ilegible");
});

// --------------------------------------------------------------------------
// Frente contra reverso
// --------------------------------------------------------------------------

const FRENTE = { curp: CURP_1999, vigencia: "2023 - 2033", nombre: "PRUEBA SINTETICA PERSONA" };

test("frente y reverso: coinciden nacimiento, vencimiento y nombre", () => {
  assert.equal(cotejarFrenteConReverso(FRENTE, zonaSintetica()), "coincide");
});

test("frente y reverso: un nacimiento o un vencimiento distinto dice que no son del mismo documento", () => {
  assert.equal(cotejarFrenteConReverso(FRENTE, zonaSintetica({ nacimiento: "990116" })), "no");
  assert.equal(cotejarFrenteConReverso(FRENTE, zonaSintetica({ vencimiento: "341231" })), "no");
  assert.equal(cotejarFrenteConReverso(FRENTE, zonaSintetica({ nombres: "OTRA<GENTE<<DISTINTA" })), "no");
});

test("frente y reverso: con lo que se pudo comparar es parcial; sin zona valida, ilegible", () => {
  assert.equal(cotejarFrenteConReverso({ curp: CURP_1999 }, zonaSintetica()), "parcial");
  assert.equal(cotejarFrenteConReverso({}, zonaSintetica()), "ilegible", "con el frente vacio no hay nada que comparar");
  assert.equal(cotejarFrenteConReverso(FRENTE, null), "ilegible");
  const [l1 = "", l2 = "", l3 = ""] = zonaSintetica();
  assert.equal(cotejarFrenteConReverso(FRENTE, [l1, conCaracter(l2, 6, "6"), l3]), "ilegible", "zona invalida");
});

test("frente y reverso: la ultima palabra cortada en el caracter 30 no se cuenta", () => {
  const nombres = "PRUEBA<SINTETICA<<PERSONA<SEGU"; // 30 justos, sin relleno: se corto
  assert.equal(nombres.length, 30);
  const frente = { ...FRENTE, nombre: "PRUEBA SINTETICA PERSONA SEGUNDONOMBRE" };
  assert.equal(cotejarFrenteConReverso(frente, zonaSintetica({ nombres })), "coincide");
});

test("ningun validador devuelve otra cosa que un indicador", () => {
  const resultados = [
    validarCurp(CURP_1999),
    validarCurp("basura"),
    validarClaveElector(CLAVE, CURP_1999),
    validarVigencia("2023 - 2033", 2026),
    validarMrzIne(zonaSintetica()),
    cotejarNombre(FRENTE.nombre, "Persona Prueba"),
    cotejarFrenteConReverso(FRENTE, zonaSintetica()),
    esMayorDeEdad(CURP_1999, HOY),
  ];
  for (const r of resultados) assert.ok(PERMITIDOS.has(r), r);
});
