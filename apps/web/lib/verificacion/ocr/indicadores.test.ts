/**
 * De la lectura a indicadores: que salen los estados correctos y, sobre todo,
 * que NO sale nada de lo leido.
 *
 * El lector falso vive SOLO aqui y entra por parametro a leerIndicadores. No
 * hay uno en el codigo de la app ni uno que se active con una variable de
 * entorno: asi no puede acabar escribiendo indicadores inventados en
 * produccion. Datos sinteticos (lib/pruebas/documentos-sinteticos.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cotejarUniversidad, leerIndicadores, reducirAIndicadores } from "./indicadores";
import type {
  ContextoDelCotejo,
  ImagenesDelDocumento,
  IndicadoresLectura,
  LecturaDocumento,
  LectorDeDocumento,
  TipoDeDocumento,
} from "./tipos";
import { conCaracter, curpSintetica, zonaSintetica } from "../../pruebas/documentos-sinteticos";

const HOY = new Date("2026-11-07T18:00:00Z");
const CURP = curpSintetica("XXXX990115HPLXXX0");

const LECTURA_INE: LecturaDocumento = {
  nombre: "PRUEBA SINTETICA PERSONA",
  curp: CURP,
  clave_elector: "XXXXXX99011521H000",
  vigencia: "2023 - 2033",
  universidad: null,
  mrz: zonaSintetica(),
};

const CONTEXTO_INE: ContextoDelCotejo = {
  tipo: "INE",
  nombreRegistrado: "Persona Prueba Sintética",
  universidadDeclarada: null,
  hoy: HOY,
};

const LECTURA_UNIVERSITARIA: LecturaDocumento = {
  nombre: "PERSONA PRUEBA",
  curp: null,
  clave_elector: null,
  vigencia: "CICLO 2026 - 2027",
  universidad: "UNIVERSIDAD MADERO",
  mrz: null,
};

const CONTEXTO_UNIVERSITARIA: ContextoDelCotejo = {
  tipo: "Credencial Universitaria",
  nombreRegistrado: "Persona Prueba",
  universidadDeclarada: "UMAD",
  hoy: HOY,
};

const IMAGENES: ImagenesDelDocumento = {
  frente: { mime: "image/png", bytes: Uint8Array.of(1, 2, 3) },
  reverso: { mime: "image/png", bytes: Uint8Array.of(4, 5, 6) },
};

/** Cada campo leido entero y cada palabra suya de 4 o mas caracteres. */
function cadenasDeLaLectura(lectura: LecturaDocumento): string[] {
  const campos = [
    lectura.nombre,
    lectura.curp,
    lectura.clave_elector,
    lectura.vigencia,
    lectura.universidad,
    ...(lectura.mrz ?? []),
  ].filter((v): v is string => typeof v === "string" && v !== "");
  const palabras = campos.flatMap((c) => c.split(/[^\p{L}\p{N}]+/u)).filter((p) => p.length >= 4);
  return [...new Set([...campos, ...palabras])];
}

/** Falla si algun valor de los indicadores contiene una cadena de la lectura. */
function afirmarSinCadenasDeLaLectura(indicadores: Readonly<Record<string, unknown>>, lectura: LecturaDocumento): void {
  const valores = Object.values(indicadores).map((v) => JSON.stringify(v).toUpperCase());
  for (const cadena of cadenasDeLaLectura(lectura)) {
    for (const valor of valores) {
      assert.ok(!valor.includes(cadena.toUpperCase()), `un indicador contiene texto leido del documento: «${cadena}»`);
    }
  }
}

/** Devuelve `respuesta` tal cual (aunque no tenga la forma) o lanza si es un Error. */
function lectorFalso(respuesta: unknown) {
  const recibido: Array<{ claves: string[]; tipo: TipoDeDocumento }> = [];
  const lector: LectorDeDocumento = {
    proveedor: "falso-de-prueba",
    async leer(imagenes, tipo) {
      recibido.push({ claves: Object.keys(imagenes).sort(), tipo });
      if (respuesta instanceof Error) throw respuesta;
      return respuesta as LecturaDocumento;
    },
  };
  return { lector, recibido };
}

test("INE coherente: todos los indicadores en positivo y la universidad no aplica", () => {
  const esperado: IndicadoresLectura = {
    nombre: "coincide",
    curp: "valida",
    clave_elector: "valida",
    vigencia: "valida",
    mrz: "valida",
    mismo_documento: "coincide",
    mayor_de_edad: "si",
    universidad: "no_aplica",
  };
  assert.deepEqual(reducirAIndicadores(LECTURA_INE, CONTEXTO_INE), esperado);
});

test("INE con un caracter de la CURP cambiado: se nota en la CURP, la edad y el cotejo", () => {
  const lectura = { ...LECTURA_INE, curp: conCaracter(CURP, 1, "Y") };
  const indicadores = reducirAIndicadores(lectura, CONTEXTO_INE);
  assert.equal(indicadores.curp, "invalida");
  assert.equal(indicadores.mayor_de_edad, "no_determinable");
  // Sin una CURP valida la clave solo se mira por su forma, y el frente se
  // coteja con lo que queda (vigencia y nombre).
  assert.equal(indicadores.clave_elector, "valida");
  assert.equal(indicadores.mismo_documento, "parcial");
});

test("INE de un menor con la letra de la posicion 17 leida como digito: la edad no se da por buena", () => {
  // Nacido el 5 de mayo de 2010 (sintetico). La G leida como 6 pasa el digito
  // verificador y manda el nacimiento a 1910.
  const real = curpSintetica("XXXX100505HPLXXXG");
  const lectura = {
    ...LECTURA_INE,
    curp: conCaracter(real, 17, "6"),
    clave_elector: "XXXXXX10050521H000",
    mrz: zonaSintetica({ nacimiento: "100505" }),
  };
  const indicadores = reducirAIndicadores(lectura, CONTEXTO_INE);
  assert.equal(indicadores.curp, "valida", "el digito verificador no lo ve");
  assert.equal(indicadores.mayor_de_edad, "no_determinable");
  assert.equal(reducirAIndicadores({ ...lectura, curp: real }, CONTEXTO_INE).mayor_de_edad, "no");
});

test("la clave se coteja con la CURP usando el mismo hoy que el indicador de la CURP", () => {
  // CURP de nacimiento futuro (2099) y una clave con otro dia: la CURP sale
  // invalida y la clave queda solo por su forma, en vez de 'invalida' por
  // cotejarla con una CURP que su propio indicador rechaza.
  const lectura = { ...LECTURA_INE, curp: curpSintetica("XXXX990115HPLXXXA"), clave_elector: "XXXXXX99011621H000" };
  const indicadores = reducirAIndicadores(lectura, CONTEXTO_INE);
  assert.equal(indicadores.curp, "invalida");
  assert.equal(indicadores.clave_elector, "valida");
});

test("credencial universitaria: nombre, vigencia y universidad; lo de la INE no aplica", () => {
  assert.deepEqual(reducirAIndicadores(LECTURA_UNIVERSITARIA, CONTEXTO_UNIVERSITARIA), {
    nombre: "coincide",
    curp: "no_aplica",
    clave_elector: "no_aplica",
    vigencia: "valida",
    mrz: "no_aplica",
    mismo_documento: "no_aplica",
    mayor_de_edad: "no_aplica",
    universidad: "coincide",
  });
});

test("los indicadores no contienen ninguna cadena de la lectura de entrada", () => {
  const casos: Array<[LecturaDocumento, ContextoDelCotejo]> = [
    [LECTURA_INE, CONTEXTO_INE],
    [{ ...LECTURA_INE, curp: conCaracter(CURP, 1, "Y"), nombre: "OTRA GENTE DISTINTA" }, CONTEXTO_INE],
    [{ ...LECTURA_INE, mrz: zonaSintetica({ nacimiento: "990116" }) }, CONTEXTO_INE],
    [LECTURA_UNIVERSITARIA, CONTEXTO_UNIVERSITARIA],
    [{ ...LECTURA_UNIVERSITARIA, universidad: "INSTITUTO QUETZALCOATL DE PRUEBAS" }, CONTEXTO_UNIVERSITARIA],
  ];
  for (const [lectura, contexto] of casos) {
    afirmarSinCadenasDeLaLectura(reducirAIndicadores(lectura, contexto), lectura);
  }
});

test("la comprobacion anterior SI detecta una fuga (si no, no vigilaria nada)", () => {
  const indicadores = reducirAIndicadores(LECTURA_INE, CONTEXTO_INE);
  assert.throws(() => afirmarSinCadenasDeLaLectura({ ...indicadores, filtrado: LECTURA_INE.curp }, LECTURA_INE));
  assert.throws(() => afirmarSinCadenasDeLaLectura({ ...indicadores, filtrado: "persona" }, LECTURA_INE));
});

test("leerIndicadores usa el lector inyectado y solo le pasa frente y reverso", async () => {
  const { lector, recibido } = lectorFalso(LECTURA_INE);
  // Aunque quien llame cuele la selfie, al lector no le llega.
  const conSelfie = { ...IMAGENES, selfie: { mime: "image/png", bytes: Uint8Array.of(9) } } as ImagenesDelDocumento;
  const resultado = await leerIndicadores(lector, conSelfie, CONTEXTO_INE);
  assert.deepEqual(recibido, [{ claves: ["frente", "reverso"], tipo: "INE" }]);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.proveedor, "falso-de-prueba");
  if (resultado.ok) afirmarSinCadenasDeLaLectura(resultado.indicadores, LECTURA_INE);
});

test("si el lector falla, no se propaga su error (podria citar lo que leyo)", async () => {
  const { lector } = lectorFalso(new Error(`no pude con la CURP ${CURP}`));
  const resultado = await leerIndicadores(lector, IMAGENES, CONTEXTO_INE);
  assert.deepEqual(resultado, { ok: false, proveedor: "falso-de-prueba", motivo: "fallo_del_lector" });
  assert.equal(JSON.stringify(resultado).includes(CURP), false);
});

test("una respuesta sin la forma esperada cuenta como no leida, sin lanzar", async () => {
  for (const basura of [null, 42, "texto", { curp: 7, mrz: "no es arreglo", nombre: ["x"] }, { mrz: [1, 2, 3] }]) {
    const { lector } = lectorFalso(basura);
    const resultado = await leerIndicadores(lector, IMAGENES, CONTEXTO_INE);
    assert.equal(resultado.ok, true);
    if (!resultado.ok) continue;
    assert.equal(resultado.indicadores.curp, "ilegible");
    assert.equal(resultado.indicadores.mrz, "ilegible");
    assert.equal(resultado.indicadores.nombre, "ilegible");
    assert.equal(resultado.indicadores.mismo_documento, "ilegible");
  }
});

test("un `hoy` invalido es un error de quien llama, no un indicador", () => {
  assert.throws(() => reducirAIndicadores(LECTURA_INE, { ...CONTEXTO_INE, hoy: new Date("x") }), RangeError);
});

test("universidad: por sus formas impresas, palabra por palabra", () => {
  assert.equal(cotejarUniversidad("UNIVERSIDAD ANÁHUAC PUEBLA", "Universidad Anáhuac"), "coincide");
  assert.equal(cotejarUniversidad("Tec de Monterrey, campus Puebla", "Tecnológico de Monterrey"), "coincide");
  assert.equal(cotejarUniversidad("BENEMÉRITA UNIVERSIDAD AUTÓNOMA DE PUEBLA", "BUAP"), "coincide");
  assert.equal(cotejarUniversidad("UNIVERSIDAD DEL VALLE DE PUEBLA", "UVP"), "coincide");
  assert.equal(cotejarUniversidad("UNIVERSIDAD DEL VALLE DE PUEBLA", "UVM"), "no", "es la otra del valle");
  assert.equal(cotejarUniversidad("BUAPX", "BUAP"), "no", "no por subcadena");
  assert.equal(cotejarUniversidad("UNIVERSIDAD MADERO", "BUAP"), "no");
});

test("universidad: fuera de la lista no se puede cotejar; sin lectura es ilegible", () => {
  assert.equal(cotejarUniversidad("INSTITUTO QUETZALCOATL", "Instituto Quetzalcoatl"), "no_cotejable");
  assert.equal(cotejarUniversidad("UNIVERSIDAD MADERO", null), "no_cotejable");
  assert.equal(cotejarUniversidad("UNIVERSIDAD MADERO", "   "), "no_cotejable");
  assert.equal(cotejarUniversidad(null, "UMAD"), "ilegible");
  assert.equal(cotejarUniversidad("UNIVERS?DAD MADERO", "UMAD"), "ilegible");
  assert.equal(cotejarUniversidad("  ", "UMAD"), "ilegible");
});
