/**
 * Tipos del lector de documentos (OCR). Sin proveedor, sin red y sin entorno.
 *
 * El lector es INTERCAMBIABLE: el primer adaptador seria el modelo de vision
 * que ya esta integrado y, si se decide dejar de mandar documentos a un
 * tercero, otro (Google Vision, Tesseract en el servidor). Todos devuelven lo
 * mismo, una LecturaDocumento, y de ahi solo sale una IndicadoresLectura, que
 * es lo unico que se podria guardar o ensenar.
 *
 * Nada de esto esta conectado todavia. Ver
 * openspec/changes/2026-11-07-ocr-verificacion/.
 */
import type { EstadoDeCampo, EstadoDeCotejo, EstadoDeMayoria } from "../campos-documento";

export type TipoDeDocumento = "INE" | "Credencial Universitaria";

export type ImagenDelDocumento = {
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: Uint8Array;
};

/**
 * Frente y reverso, nada mas. La selfie NO va al lector: leer texto no la
 * necesita, y es el dato biometrico del tramite.
 */
export type ImagenesDelDocumento = {
  readonly frente: ImagenDelDocumento;
  readonly reverso: ImagenDelDocumento;
};

/**
 * Lo que el lector leyo, campo por campo.
 *
 * SOLO EN MEMORIA. Nunca se guarda, nunca se manda a Sentry ni a un log y
 * nunca sale de la peticion: se reduce a indicadores y se descarta. Un campo
 * que el lector no pudo leer va como null; un caracter que no pudo leer, como
 * '?' (CARACTER_ILEGIBLE), y entonces el campo cuenta como ilegible.
 *
 * Fuera a proposito: domicilio, seccion, firma, fecha de nacimiento completa
 * y matricula. Lo que no se lee no se puede filtrar.
 */
export type LecturaDocumento = {
  readonly nombre: string | null;
  readonly curp: string | null;
  readonly clave_elector: string | null;
  readonly vigencia: string | null;
  readonly universidad: string | null;
  /** Las tres lineas de la zona de lectura mecanica del reverso de la INE. */
  readonly mrz: readonly string[] | null;
};

/** Un adaptador de OCR. Se inyecta por parametro: nadie lo elige leyendo el entorno. */
export interface LectorDeDocumento {
  /** Nombre corto del adaptador, para el registro. No es un dato del documento. */
  readonly proveedor: string;
  leer(imagenes: ImagenesDelDocumento, tipo: TipoDeDocumento): Promise<LecturaDocumento>;
}

/** Lo que el cotejo necesita y NO sale del documento. */
export type ContextoDelCotejo = {
  readonly tipo: TipoDeDocumento;
  /** profiles.nombre, igual que lo que hoy recibe el modelo. */
  readonly nombreRegistrado: string;
  /** La universidad declarada (solo credencial universitaria). */
  readonly universidadDeclarada: string | null;
  readonly hoy: Date;
};

export type NoAplica = "no_aplica";

/**
 * 'no_cotejable': la universidad declarada no esta en la lista conocida (el
 * servidor acepta cualquier nombre con forma plausible, la lista solo vive en
 * la interfaz), asi que no se puede decir «no coincide».
 */
export type EstadoDeUniversidad = "coincide" | "no" | "ilegible" | "no_cotejable";

/**
 * Lo unico que sale del lector: estados, sin valores. Es `type` y no
 * `interface` para poder guardarse en una columna Json (ver veredicto.ts).
 */
export type IndicadoresLectura = {
  readonly nombre: EstadoDeCotejo;
  readonly curp: EstadoDeCampo | NoAplica;
  readonly clave_elector: EstadoDeCampo | NoAplica;
  readonly vigencia: EstadoDeCampo;
  readonly mrz: EstadoDeCampo | NoAplica;
  /** Frente contra reverso: nacimiento, vencimiento y nombre de la zona de lectura. */
  readonly mismo_documento: EstadoDeCotejo | NoAplica;
  readonly mayor_de_edad: EstadoDeMayoria | NoAplica;
  readonly universidad: EstadoDeUniversidad | NoAplica;
};

/**
 * El resultado de pasar un documento por un lector. Un fallo no trae el error
 * del proveedor: su mensaje puede citar lo que leyo.
 */
export type ResultadoDeLectura =
  | { readonly ok: true; readonly proveedor: string; readonly indicadores: IndicadoresLectura }
  | { readonly ok: false; readonly proveedor: string; readonly motivo: "fallo_del_lector" };
