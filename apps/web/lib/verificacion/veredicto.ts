/**
 * La decision de aprobar, rechazar o mandar a una persona. Logica pura.
 *
 * POR QUE VIVE AQUI Y NO EN LA SERVER ACTION. Es lo mas delicado de todo el
 * flujo de verificacion —decide sobre la identidad de alguien, y un rechazo es
 * en la practica irreversible— y dentro de app/actions/verify-document.ts no
 * se podia probar: en un modulo "use server" TODA exportacion es un endpoint
 * HTTP publico, y una que no sea una funcion async es un 500 en runtime que
 * tsc, lint y build dejan pasar. O sea que exportarla para un test habria roto
 * la pagina. Aqui es un modulo normal, la accion la importa, y los casos que
 * importan tienen prueba en scripts/test-veredicto-verificacion.ts.
 *
 * No hay nada de red, ni de Supabase, ni de entorno: entra un analisis, sale
 * un estado.
 */

/** Confianza minima para aprobar sin que lo vea una persona. */
export const UMBRAL_CONFIANZA = 90;
/** Confianza minima del cotejo de rostro. Por debajo, decide una persona. */
export const UMBRAL_ROSTRO = 85;
/** Confianza minima para tomarse en serio un hallazgo negativo del modelo. */
export const UMBRAL_RECHAZO = 70;

export type CaraDelDocumento = {
  legible: boolean;
  vigente: boolean;
  sellos_o_elementos_de_seguridad: boolean;
  observacion: string | null;
};

export type ReversoDelDocumento = {
  presente: boolean;
  legible: boolean;
  corresponde_al_frente: boolean;
  observacion: string | null;
};

export type CotejoDeRostro = {
  rostro_detectado: boolean;
  misma_persona: boolean;
  confianza_rostro_porcentaje: number;
  observacion: string | null;
};

/**
 * Las formas del analisis son `type` y no `interface` a proposito.
 *
 * El objeto se guarda en ai_analysis_raw, que en los tipos generados es `Json`
 * —o sea `{ [k: string]: Json | undefined }`—. Un `interface` no recibe indice
 * implicito, asi que no es asignable a Json y el UPDATE deja de compilar con
 * «Index signature is missing». Un alias de tipo si lo recibe.
 */
export type AnalisisDocumento = {
  es_credencial_valida: boolean;
  tipo_detectado: string | null;
  nombre_en_documento: string | null;
  el_nombre_coincide: boolean;
  nombre_universidad: string | null;
  /** null cuando el tramite no es universitario y no habia nada que cotejar. */
  la_universidad_coincide: boolean | null;
  vigente: boolean;
  frente: CaraDelDocumento;
  reverso: ReversoDelDocumento;
  selfie: CotejoDeRostro;
  confianza_porcentaje: number;
  veredicto: "aprobar" | "rechazar" | "revision_humana";
  /** Lo que lee el panel de admin. El nombre de la clave es contrato con esa pagina. */
  motivo_rechazo_o_duda: string | null;
};

/** Los tres estados que entiende la columna `status` de seller_verification. */
export type EstadoDelVeredicto = "approved" | "rejected" | "pending";

/**
 * El veredicto que decide el servidor, no el modelo.
 *
 * El modelo propone en `veredicto`, pero aqui se vuelve a exigir cada
 * condicion por separado: una respuesta que diga "aprobar" con la cara sin
 * cotejar, o con el reverso ausente, no puede aprobar nada. Y al contrario,
 * una foto mala no es un fraude: eso va a revision humana, no a rechazo.
 *
 * `aprobacionAutomatica` llega como parametro y no se lee del entorno aqui
 * para que la funcion siga siendo pura y se pueda probar en los dos modos.
 */
export function decidirEstado(
  a: AnalisisDocumento,
  esUniversitaria: boolean,
  aprobacionAutomatica: boolean,
): EstadoDelVeredicto {
  // UN RECHAZO NECESITA UN HALLAZGO FUNDADO, Y ESO VALE PARA LOS CINCO
  // CAMINOS, no solo para el veredicto del modelo.
  //
  // Importa mas de lo que parece: 'rejected' es un estado resuelto, asi que el
  // cron de purga borra las tres imagenes en menos de una hora y la cola del
  // panel —que solo lista 'pending'— deja de mostrar el tramite. Un rechazo
  // automatico es, en la practica, irreversible: ni el admin lo ve, ni quedan
  // documentos que revisar.
  //
  // Antes solo `rechazoFundado` tenia piso y los otros cuatro disyuntos
  // rechazaban a pelo. Con eso, una respuesta como {"misma_persona": false,
  // "confianza_rostro_porcentaje": 35, "veredicto": "revision_humana"}
  // rechazaba a alguien con 35 de confianza y con el propio modelo pidiendo
  // que lo viera una persona. Y una foto mala no es un fraude.
  const documentoLegible = a.frente.legible;
  const confianzaSuficiente = a.confianza_porcentaje >= UMBRAL_RECHAZO;

  // Si el frente no se lee, «no es una credencial valida» y «el nombre no
  // coincide» no pueden ser evidencia de nada: son consecuencia de no ver.
  const documentoFalla =
    documentoLegible &&
    confianzaSuficiente &&
    (!a.es_credencial_valida || !a.el_nombre_coincide);

  // El cotejo de rostro es lo mas ruidoso de las tres imagenes, y por eso su
  // propio umbral: por debajo de UMBRAL_ROSTRO este archivo ya declara que no
  // es fiable para aprobar, asi que tampoco lo es para rechazar.
  const caraDistinta =
    a.selfie.rostro_detectado &&
    !a.selfie.misma_persona &&
    a.selfie.confianza_rostro_porcentaje >= UMBRAL_ROSTRO;

  const universidadFalla =
    esUniversitaria &&
    documentoLegible &&
    confianzaSuficiente &&
    a.la_universidad_coincide === false;

  const rechazoFundado = a.veredicto === "rechazar" && confianzaSuficiente;

  if (rechazoFundado || documentoFalla || caraDistinta || universidadFalla) {
    return "rejected";
  }

  const todoCuadra =
    a.veredicto === "aprobar" &&
    a.confianza_porcentaje >= UMBRAL_CONFIANZA &&
    a.es_credencial_valida &&
    a.vigente &&
    a.el_nombre_coincide &&
    a.frente.legible &&
    a.frente.vigente &&
    a.frente.sellos_o_elementos_de_seguridad &&
    a.reverso.presente &&
    a.reverso.legible &&
    a.reverso.corresponde_al_frente &&
    a.selfie.rostro_detectado &&
    a.selfie.misma_persona &&
    a.selfie.confianza_rostro_porcentaje >= UMBRAL_ROSTRO &&
    (!esUniversitaria || a.la_universidad_coincide === true);

  if (!todoCuadra) return "pending";

  // 'pending' y no 'approved' mientras la bandera este apagada. Un 'approved'
  // por este camino no reparte insignia ni puntos —eso solo lo hace
  // approve_verification_atomic— y ademas hace que el cron borre los tres
  // documentos y que la fila salga de la cola del panel, asi que nadie podria
  // arreglarlo despues. Sale mas caro que esperar a una persona.
  return aprobacionAutomatica ? "approved" : "pending";
}

/**
 * Que condiciones de `todoCuadra` fallan, en palabras para el revisor.
 *
 * Existe porque con la aprobacion automatica apagada TODO «aprobar» del modelo
 * termina en 'pending', y la nota no decia si era un «todo cuadra» o un «el
 * modelo propone aprobar pero el rostro no coincide». Mismas condiciones que
 * decidirEstado (si cambian alla, cambian aqui). Sin datos del documento: solo
 * el nombre de la condicion.
 */
export function alarmasDelAnalisis(a: AnalisisDocumento, esUniversitaria: boolean): string[] {
  const alarmas: string[] = [];
  if (a.confianza_porcentaje < UMBRAL_CONFIANZA) alarmas.push(`confianza baja (${a.confianza_porcentaje} %)`);
  if (!a.es_credencial_valida) alarmas.push("documento no válido");
  if (!a.vigente || !a.frente.vigente) alarmas.push("documento no vigente");
  if (!a.el_nombre_coincide) alarmas.push("el nombre no coincide");
  if (!a.frente.legible) alarmas.push("frente ilegible");
  if (!a.frente.sellos_o_elementos_de_seguridad) alarmas.push("sin elementos de seguridad");
  if (!a.reverso.presente || !a.reverso.legible) alarmas.push("reverso ausente o ilegible");
  if (!a.reverso.corresponde_al_frente) alarmas.push("el reverso no corresponde al frente");
  if (!a.selfie.rostro_detectado) alarmas.push("no se detecta rostro en la selfie");
  else if (!a.selfie.misma_persona || a.selfie.confianza_rostro_porcentaje < UMBRAL_ROSTRO) {
    alarmas.push(`el rostro no coincide o no es seguro (${a.selfie.confianza_rostro_porcentaje} %)`);
  }
  if (esUniversitaria && a.la_universidad_coincide !== true) alarmas.push("la universidad no coincide");
  return alarmas;
}

/**
 * Las alarmas GRAVES: las que apuntan a identidad o documento falsos, no a una
 * foto mala. Sirven para que muchas dudas triviales (fotos borrosas) no saquen
 * del historial una alarma grave. Sin datos del documento.
 */
export function alarmasGraves(a: AnalisisDocumento, esUniversitaria: boolean): string[] {
  const graves: string[] = [];
  if (!a.es_credencial_valida) graves.push("documento no válido");
  if (!a.el_nombre_coincide) graves.push("el nombre no coincide");
  if (a.selfie.rostro_detectado && !a.selfie.misma_persona) graves.push("el rostro no coincide");
  if (!a.reverso.corresponde_al_frente) graves.push("el reverso no corresponde al frente");
  if (esUniversitaria && a.la_universidad_coincide === false) graves.push("la universidad no coincide");
  return graves;
}
