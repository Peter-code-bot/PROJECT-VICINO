/**
 * Versiones de los documentos legales, en un solo sitio.
 *
 * AVISO_PRIVACIDAD_VERSION ya existia aqui, pero no lo usaba NADIE: la version
 * se volvia a escribir a mano dentro del JSX de cada pagina ("Version 2.1",
 * "Ultima actualizacion: 17 de junio de 2026"). Dos copias del mismo dato que
 * nada obliga a coincidir.
 *
 * Eso hace imposible cumplir dos obligaciones que el propio Aviso se impone:
 *
 *   - Registrar QUE VERSION acepto cada usuario. Sin un identificador estable
 *     no hay nada que guardar: "acepto el Aviso" no dice cual.
 *   - Notificar cambios sustanciales con 30 dias de anticipacion (Aviso §18).
 *     Para saber a quien avisar hace falta saber quien acepto una version
 *     anterior.
 *
 * Ahora la pagina MUESTRA la version desde aqui y el registro la GUARDA desde
 * aqui. No pueden desincronizarse.
 *
 * REGLA AL ACTUALIZAR UN DOCUMENTO: subir la version aqui es lo que dispara
 * todo lo demas.
 *
 * HISTORIAL
 *   Aviso 2.1 -> 2.2 y Terminos 1.0 -> 1.1 (26-ago-2026): la seccion 4.2 del
 *   Aviso y la 7 de los Terminos solo declaraban la Credencial para Votar del
 *   INE, mientras el producto YA acepta la credencial universitaria. Se
 *   sustituyen por una formula abierta que enumera las aceptadas hoy y remite
 *   al flujo de verificacion para las que se habiliten despues, de modo que
 *   ampliar los documentos aceptados no obligue a reeditar los textos legales.
 *
 *   OJO, y es decision de Pedro, no del codigo: el propio Aviso promete en su
 *   seccion 18 avisar los cambios SUSTANCIALES con 30 dias de anticipacion. Si
 *   este cambio se considera sustancial, el aviso tiene que salir ANTES de que
 *   la version nueva entre en vigor. Con 11 usuarios eso cabe en un correo. Si se edita el texto sin tocar esto, los usuarios quedan
 * registrados como si hubieran aceptado algo que ya no dice lo mismo.
 */

/** Versión vigente del Aviso de Privacidad de VICINO. */
export const AVISO_PRIVACIDAD_VERSION = "2.2" as const;

/** Fecha de la versión vigente, como se muestra al usuario. */
export const AVISO_PRIVACIDAD_ACTUALIZADO = "26 de agosto de 2026" as const;

/** Versión vigente de los Términos y Condiciones. */
export const TERMINOS_VERSION = "1.1" as const;

/** Fecha de los Términos vigentes, como se muestra al usuario. */
export const TERMINOS_ACTUALIZADO = "26 de agosto de 2026" as const;

/**
 * Tipos de consentimiento que se registran en `verification_consent`.
 *
 * `biometrico` cubre la selfie de verificación de identidad. Es dato
 * biométrico y por tanto sensible bajo la LFPDPPP: exige consentimiento
 * EXPRESO y por escrito, no el tácito que basta para el resto.
 */
export const TIPO_CONSENTIMIENTO = {
  biometrico: "biometrico",
} as const;

export type TipoConsentimiento =
  (typeof TIPO_CONSENTIMIENTO)[keyof typeof TIPO_CONSENTIMIENTO];
