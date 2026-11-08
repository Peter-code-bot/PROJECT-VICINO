/**
 * De una lectura de documento a indicadores sin valores. Logica pura.
 *
 * La LecturaDocumento trae texto del documento (nombre, CURP, clave de
 * elector); lo que sale de aqui son solo estados ('valida', 'coincide',
 * 'ilegible'...). Ningun campo de la salida se construye con texto de la
 * entrada: lo vigila una prueba que falla si aparece cualquier cadena leida.
 *
 * Nada de esto decide: los indicadores son para que el revisor sepa donde
 * mirar (ver campos-documento.ts). Todavia no tiene llamadores.
 */
import {
  CARACTER_ILEGIBLE,
  anioEnMexico,
  cotejarFrenteConReverso,
  cotejarNombre,
  esMayorDeEdad,
  validarClaveElector,
  validarCurp,
  validarMrzIne,
  validarVigencia,
} from "../campos-documento";
import type {
  ContextoDelCotejo,
  EstadoDeUniversidad,
  ImagenesDelDocumento,
  IndicadoresLectura,
  LecturaDocumento,
  LectorDeDocumento,
  ResultadoDeLectura,
} from "./tipos";

/**
 * Las universidades de la lista de la interfaz (verification-upload.tsx) con
 * los nombres con los que aparecen impresas. La primera forma de cada una es
 * la de la lista. Si la lista cambia y esto no, la nueva sale 'no_cotejable',
 * que es el lado seguro.
 */
const UNIVERSIDADES_CONOCIDAS: readonly (readonly string[])[] = [
  ["BUAP", "BENEMERITA UNIVERSIDAD AUTONOMA DE PUEBLA"],
  ["UDLAP", "UNIVERSIDAD DE LAS AMERICAS PUEBLA"],
  ["UPAEP", "UNIVERSIDAD POPULAR AUTONOMA DEL ESTADO DE PUEBLA"],
  [
    "TECNOLOGICO DE MONTERREY",
    "TEC DE MONTERREY",
    "ITESM",
    "INSTITUTO TECNOLOGICO Y DE ESTUDIOS SUPERIORES DE MONTERREY",
  ],
  ["UNIVERSIDAD IBEROAMERICANA", "IBERO"],
  ["UNIVERSIDAD ANAHUAC", "ANAHUAC"],
  ["UVM", "UNIVERSIDAD DEL VALLE DE MEXICO"],
  ["UMAD", "UNIVERSIDAD MADERO"],
  ["UVP", "UNIVERSIDAD DEL VALLE DE PUEBLA"],
];

const MAX_LARGO_UNIVERSIDAD = 160;

function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p !== "");
}

/** ¿`buscada` aparece entera y seguida dentro de `texto`? Palabra por palabra, no por subcadena. */
function contieneSecuencia(texto: readonly string[], buscada: readonly string[]): boolean {
  if (buscada.length === 0 || buscada.length > texto.length) return false;
  for (let inicio = 0; inicio + buscada.length <= texto.length; inicio++) {
    if (buscada.every((p, i) => texto[inicio + i] === p)) return true;
  }
  return false;
}

function universidadDeclarada(declarada: string | null): readonly string[] | null {
  if (typeof declarada !== "string" || declarada.length > MAX_LARGO_UNIVERSIDAD) return null;
  const clave = palabras(declarada).join(" ");
  if (clave === "") return null;
  return UNIVERSIDADES_CONOCIDAS.find((formas) => formas.some((f) => palabras(f).join(" ") === clave)) ?? null;
}

/**
 * La universidad leida contra la declarada: 'coincide' si lo leido contiene
 * alguna de sus formas impresas; 'no' si se leyo otra cosa; 'no_cotejable' si
 * la declarada no esta en la lista conocida.
 */
export function cotejarUniversidad(leida: string | null, declarada: string | null): EstadoDeUniversidad {
  const formas = universidadDeclarada(declarada);
  if (formas === null) return "no_cotejable";
  if (typeof leida !== "string" || leida.length > MAX_LARGO_UNIVERSIDAD || leida.includes(CARACTER_ILEGIBLE)) {
    return "ilegible";
  }
  const texto = palabras(leida);
  if (texto.length === 0) return "ilegible";
  return formas.some((forma) => contieneSecuencia(texto, palabras(forma))) ? "coincide" : "no";
}

/**
 * Un adaptador puede devolver cualquier cosa (la respuesta de un modelo, por
 * ejemplo), asi que lo que no tenga la forma esperada cuenta como no leido.
 */
function sanear(valor: unknown): LecturaDocumento {
  const o: Record<string, unknown> = typeof valor === "object" && valor !== null ? { ...valor } : {};
  const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const mrz = Array.isArray(o.mrz) && o.mrz.every((linea) => typeof linea === "string") ? [...(o.mrz as string[])] : null;
  return {
    nombre: texto(o.nombre),
    curp: texto(o.curp),
    clave_elector: texto(o.clave_elector),
    vigencia: texto(o.vigencia),
    universidad: texto(o.universidad),
    mrz,
  };
}

export function reducirAIndicadores(lectura: LecturaDocumento, contexto: ContextoDelCotejo): IndicadoresLectura {
  const l = sanear(lectura);
  const nombre = cotejarNombre(l.nombre, contexto.nombreRegistrado);
  const vigencia = validarVigencia(l.vigencia, anioEnMexico(contexto.hoy));

  if (contexto.tipo === "Credencial Universitaria") {
    return {
      nombre,
      curp: "no_aplica",
      clave_elector: "no_aplica",
      vigencia,
      mrz: "no_aplica",
      mismo_documento: "no_aplica",
      mayor_de_edad: "no_aplica",
      universidad: cotejarUniversidad(l.universidad, contexto.universidadDeclarada),
    };
  }

  return {
    nombre,
    curp: validarCurp(l.curp, { hoy: contexto.hoy }),
    clave_elector: validarClaveElector(l.clave_elector, l.curp, { hoy: contexto.hoy }),
    vigencia,
    mrz: validarMrzIne(l.mrz),
    mismo_documento: cotejarFrenteConReverso({ curp: l.curp, vigencia: l.vigencia, nombre: l.nombre }, l.mrz),
    mayor_de_edad: esMayorDeEdad(l.curp, contexto.hoy),
    universidad: "no_aplica",
  };
}

/**
 * Pasa el frente y el reverso por el lector y devuelve solo indicadores.
 *
 * El lector llega POR PARAMETRO: no hay un lector por defecto ni uno que se
 * elija leyendo el entorno, asi que un lector falso no puede acabar en
 * produccion por una variable mal puesta. Si el lector falla, el error no se
 * propaga ni se adjunta (el mensaje de un proveedor puede citar lo que leyo):
 * quien llame registra el fallo con etiquetas y deja la solicitud a una
 * persona, igual que hoy cuando el modelo no contesta.
 */
export async function leerIndicadores(
  lector: LectorDeDocumento,
  imagenes: ImagenesDelDocumento,
  contexto: ContextoDelCotejo,
): Promise<ResultadoDeLectura> {
  let lectura: LecturaDocumento;
  try {
    lectura = await lector.leer({ frente: imagenes.frente, reverso: imagenes.reverso }, contexto.tipo);
  } catch {
    return { ok: false, proveedor: lector.proveedor, motivo: "fallo_del_lector" };
  }
  return { ok: true, proveedor: lector.proveedor, indicadores: reducirAIndicadores(lectura, contexto) };
}
