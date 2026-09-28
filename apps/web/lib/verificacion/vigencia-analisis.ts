/**
 * ¿La nota de la IA es sobre las fotos que el revisor tiene delante?
 *
 * BUG-VERIF-IA (27-sep-2026): el panel mostraba la nota de un envio anterior
 * junto a los documentos nuevos. La base marca la nota como desfasada cuando
 * cambia la FILA (seller_verification.ai_vigente, trigger
 * marcar_analisis_ia_desfasado_trg), pero cada foto vive en una ruta fija que se
 * sube con upsert: se puede reemplazar en el bucket sin tocar la fila. Eso solo
 * se ve comparando el updated_at de cada objeto con ai_analizado_en, que es la
 * version de las fotos que miro la IA. Los dos lados salen del listado de
 * Storage, asi que se comparan con el mismo reloj.
 *
 * Modulo puro a proposito: lo usan la accion de la IA (para anotar que version
 * analizo) y el panel (para comparar), y se prueba sin red.
 */

/** Lo que devuelve `storage.list()` y aqui importa. */
export interface ObjetoDeStorage {
  name: string;
  updated_at?: string | null;
}

/**
 * updated_at de cada ruta, en el mismo orden, leido del listado de `carpeta`.
 * null si la ruta no aparece (o no esta directamente dentro de la carpeta).
 */
export function versionesDeLasFotos(
  carpeta: string,
  rutas: readonly (string | null)[],
  objetos: readonly ObjetoDeStorage[],
): (string | null)[] {
  return rutas.map((ruta) => {
    if (!ruta) return null;
    const objeto = objetos.find((o) => `${carpeta}/${o.name}` === ruta);
    return objeto?.updated_at && esFecha(objeto.updated_at) ? objeto.updated_at : null;
  });
}

/** La version mas reciente del juego de fotos, o null si falta alguna. */
export function versionMasReciente(versiones: readonly (string | null)[]): string | null {
  if (versiones.length === 0 || versiones.some((v) => v === null)) return null;
  return (versiones as string[]).reduce((max, v) =>
    new Date(v).getTime() > new Date(max).getTime() ? v : max,
  );
}

export type EstadoDelAnalisis = "ninguno" | "vigente" | "desfasado" | "sin_comprobar";

/**
 * - ninguno: no hay nota.
 * - desfasado: la fila cambio despues de la nota, o alguna foto del bucket es
 *   posterior a lo que miro la IA.
 * - sin_comprobar: no hay con que comparar (nota anterior a esta columna, el
 *   listado fallo o falta un objeto). Se dice asi y no se da por buena.
 * - vigente: todas las fotos son las que analizo la IA.
 *
 * `versiones` es null cuando no se pudo listar la carpeta.
 */
export function estadoDelAnalisis(args: {
  hayAnalisis: boolean;
  vigente: boolean;
  analizadoEn: string | null;
  versiones: readonly (string | null)[] | null;
}): EstadoDelAnalisis {
  const { hayAnalisis, vigente, analizadoEn, versiones } = args;
  if (!hayAnalisis) return "ninguno";
  if (!vigente) return "desfasado";
  if (!analizadoEn || !esFecha(analizadoEn) || versiones === null) return "sin_comprobar";
  const limite = new Date(analizadoEn).getTime();
  // Una foto posterior decide aunque falte otra: esa ya seguro que no la vio.
  if (versiones.some((v) => v !== null && new Date(v).getTime() > limite)) return "desfasado";
  if (versiones.some((v) => v === null)) return "sin_comprobar";
  return "vigente";
}

/** Lo que la IA recibio ademas de las fotos; va dentro de la nota guardada. */
// `type` y no `interface`: tiene que poder guardarse en una columna Json.
export type EntradaDelAnalisis = {
  tipo: string;
  universidad: string | null;
};

/**
 * Una nota que es un veredicto de verdad, y no el aviso de «no se pudo
 * analizar» que se guarda cuando el proveedor falla (lleva respuesta_longitud).
 */
export function esVeredictoReal(nota: unknown): boolean {
  return typeof nota === "object" && nota !== null && !Array.isArray(nota) && !("respuesta_longitud" in nota);
}

/**
 * ¿La nota guardada ya es el veredicto de EXACTAMENTE esta entrada: la misma
 * version de las tres fotos, el mismo tipo y la misma universidad?
 *
 * Si lo es, volver a analizar no aporta nada: se ahorra la llamada. OJO: esto
 * solo ahorra dinero. Se salta con facilidad (resubir la misma foto le da otra
 * version en Storage; alternar la universidad cambia la entrada), asi que lo que
 * impide tapar un veredicto negativo con otro menos malo es el historial
 * (historialConNotaPrevia), no esta comprobacion. Se mira la entrada guardada
 * DENTRO de la nota y no las columnas de la fila, porque el vendedor puede
 * cambiar la universidad y volver a ponerla.
 */
export function esVeredictoDeEstaEntrada(
  nota: unknown,
  analizadoEn: string | null,
  version: string,
  entrada: EntradaDelAnalisis,
): boolean {
  if (!esVeredictoReal(nota) || !analizadoEn || !mismoInstante(analizadoEn, version)) return false;
  const guardada = (nota as Record<string, unknown>).entrada;
  if (typeof guardada !== "object" || guardada === null) return false;
  const { tipo, universidad } = guardada as Record<string, unknown>;
  return tipo === entrada.tipo && (universidad ?? null) === entrada.universidad;
}

/** Lo minimo de un veredicto anterior que el revisor necesita ver. */
export type VeredictoAnterior = {
  veredicto: string | null;
  /** Lo que DECIDIO el servidor (decidirEstado), no lo que propuso el modelo. */
  decision: string | null;
  /**
   * Si el analisis habria aprobado con la aprobacion automatica encendida.
   * Con ella apagada TODO «aprobar» queda en 'pending', asi que `decision` no
   * distingue un «todo cuadra» de un «aprobar» con alarmas: esto si.
   */
  aprobable: boolean | null;
  /** Hubo alarmas graves (identidad o documento), no solo una foto mala. */
  grave: boolean | null;
  motivo_rechazo_o_duda: string | null;
  confianza_porcentaje: number | null;
  entrada: EntradaDelAnalisis | null;
  analizado_en: string | null;
};

/**
 * Topes SEPARADOS por tipo. Con uno comun, repetir analisis de «revision
 * humana» (fotos borrosas) empujaba fuera del tope un «rechazar» fundado. Tres
 * cupos que no compiten: rechazos, alarmas graves (identidad o documento) y
 * dudas triviales.
 */
export const MAX_RECHAZOS_ANTERIORES = 20;
export const MAX_GRAVES_ANTERIORES = 10;
export const MAX_DUDAS_ANTERIORES = 10;
/** El total maximo que puede llegar a guardarse. */
export const MAX_VEREDICTOS_ANTERIORES = MAX_RECHAZOS_ANTERIORES + MAX_GRAVES_ANTERIORES + MAX_DUDAS_ANTERIORES;

/** El motivo es texto libre del modelo: se acota para no guardar de mas. */
const MAX_MOTIVO = 300;

/**
 * Un veredicto que el revisor tiene que seguir viendo: todo lo que no fue un
 * «aprobar» limpio. Cuentan tambien un «aprobar» que decidirEstado convirtio en
 * rechazo y un «aprobar» con alarmas (no aprobable). Las notas viejas sin
 * `aprobable` se tratan como antes.
 */
function esNegativo(a: VeredictoAnterior): boolean {
  if (a.veredicto === null) return false;
  if (a.decision === "rejected" || a.aprobable === false) return true;
  return a.veredicto !== "aprobar";
}

/** Rechazo (del modelo o del servidor), frente a una duda o una alarma. */
export function esRechazo(a: VeredictoAnterior): boolean {
  return a.veredicto === "rechazar" || a.decision === "rejected";
}

/**
 * Deja los negativos, sin duplicados, en orden de fecha y con los topes por
 * tipo (los mas recientes de cada uno). Es la unica forma de recortar: la usan
 * tanto la nota de una fila como la fusion entre filas.
 */
function recortar(lista: readonly VeredictoAnterior[]): VeredictoAnterior[] {
  const vistos = new Set<string>();
  const unicos: VeredictoAnterior[] = [];
  for (const a of lista) {
    if (!esNegativo(a)) continue;
    const clave = `${a.analizado_en ?? ""}|${a.veredicto ?? ""}|${a.decision ?? ""}|${a.confianza_porcentaje ?? ""}|${a.entrada?.universidad ?? ""}|${a.motivo_rechazo_o_duda ?? ""}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(a);
  }
  const fecha = (a: VeredictoAnterior) => (a.analizado_en && esFecha(a.analizado_en) ? new Date(a.analizado_en).getTime() : 0);
  const ordenados = unicos
    .map((a, i) => ({ a, i }))
    .sort((x, y) => fecha(x.a) - fecha(y.a) || x.i - y.i)
    .map((x) => x.a);
  const rechazos = ordenados.filter(esRechazo).slice(-MAX_RECHAZOS_ANTERIORES);
  const graves = ordenados.filter((a) => !esRechazo(a) && a.grave === true).slice(-MAX_GRAVES_ANTERIORES);
  const dudas = ordenados.filter((a) => !esRechazo(a) && a.grave !== true).slice(-MAX_DUDAS_ANTERIORES);
  const quedan = new Set([...rechazos, ...graves, ...dudas]);
  return ordenados.filter((a) => quedan.has(a));
}

/**
 * Historial de veredictos negativos que se lleva a la nota nueva.
 *
 * Volver a analizar reemplaza la nota entera, y el modelo no es determinista:
 * sin historial, repetir el analisis (resubir la misma foto, alternar la
 * universidad) acababa tapando un veredicto negativo con uno menos malo, y el
 * revisor nunca lo veia. Evitar el analisis duplicado solo ahorra dinero; lo
 * que cierra la puerta es que lo negativo se conserve y se ensene. OJO: esto
 * cubre UNA fila; el vendedor puede abrir otra, asi que la accion fusiona
 * ademas el historial de todas sus filas (fusionarHistoriales).
 *
 * Solo campos minimos: nada de lo que el modelo leyo del documento salvo el
 * motivo, acotado.
 */
export function historialConNotaPrevia(
  notaPrevia: unknown,
  analizadoEnPrevio: string | null,
): VeredictoAnterior[] {
  const previa = esObjeto(notaPrevia) ? notaPrevia : null;
  const yaGuardados = previa && Array.isArray(previa.anteriores)
    ? previa.anteriores.map(normalizarAnterior).filter((a): a is VeredictoAnterior => a !== null)
    : [];
  const nuevo = previa && esVeredictoReal(previa)
    ? normalizarAnterior({ ...previa, analizado_en: analizadoEnPrevio })
    : null;
  return recortar([...yaGuardados, ...(nuevo ? [nuevo] : [])]);
}

/** Une los historiales de varias filas del mismo vendedor, sin duplicados y con los topes. */
export function fusionarHistoriales(listas: readonly (readonly VeredictoAnterior[])[]): VeredictoAnterior[] {
  return recortar(listas.flat());
}

/**
 * La nota ACTUAL resumida para el panel: veredicto, decision del servidor, si
 * era aprobable y el motivo (del modelo o, si no hay, las alarmas). null si no
 * hay nota o no es un veredicto.
 */
export function resumenDeLaNota(nota: unknown): VeredictoAnterior | null {
  if (!esVeredictoReal(nota)) return null;
  const a = normalizarAnterior(nota);
  return a && a.veredicto !== null ? a : null;
}

/** Los veredictos anteriores guardados en una nota, ya saneados, para el panel. */
export function anterioresDeLaNota(nota: unknown): VeredictoAnterior[] {
  if (!esObjeto(nota) || !Array.isArray(nota.anteriores)) return [];
  return nota.anteriores
    .map(normalizarAnterior)
    .filter((a): a is VeredictoAnterior => a !== null && a.veredicto !== null);
}

function normalizarAnterior(valor: unknown): VeredictoAnterior | null {
  if (!esObjeto(valor)) return null;
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  const entrada = esObjeto(valor.entrada) && typeof valor.entrada.tipo === "string"
    ? { tipo: valor.entrada.tipo, universidad: texto(valor.entrada.universidad) }
    : null;
  // En un «aprobar» con alarmas mandan las ALARMAS y van primero (el motivo se
  // recorta): el modelo puede haber escrito algo positivo y taparlas. En el
  // resto, el motivo del modelo, y las alarmas solo si no hay motivo.
  const alarmas = Array.isArray(valor.alarmas)
    ? valor.alarmas.filter((x): x is string => typeof x === "string")
    : [];
  const delModelo = texto(valor.motivo_rechazo_o_duda);
  const conAlarmas = alarmas.length > 0 ? `No cuadra: ${alarmas.join(", ")}` : null;
  const motivo = conAlarmas && texto(valor.veredicto) === "aprobar"
    ? `${conAlarmas}${delModelo ? `. La IA escribió: ${delModelo}` : ""}`
    : delModelo ?? conAlarmas;
  return {
    veredicto: texto(valor.veredicto),
    decision: texto(valor.decision),
    aprobable: typeof valor.aprobable === "boolean" ? valor.aprobable : null,
    grave: typeof valor.grave === "boolean" ? valor.grave : null,
    motivo_rechazo_o_duda: motivo === null ? null : motivo.slice(0, MAX_MOTIVO),
    confianza_porcentaje: typeof valor.confianza_porcentaje === "number" ? valor.confianza_porcentaje : null,
    entrada,
    analizado_en: texto(valor.analizado_en),
  };
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mismoInstante(a: string, b: string): boolean {
  return esFecha(a) && esFecha(b) && new Date(a).getTime() === new Date(b).getTime();
}

function esFecha(valor: string): boolean {
  return Number.isFinite(new Date(valor).getTime());
}
