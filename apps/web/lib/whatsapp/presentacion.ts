/**
 * Lo que comparten servidor y cliente de la bandeja SIN dependencias de
 * servidor: constantes, etiquetas y la traduccion de codigos de Meta a frases.
 * Es el unico modulo de lib/whatsapp que un componente de cliente puede
 * importar; graph.ts y config.ts llevan `server-only`.
 */

/** El wa_id de Meta son digitos con lada y sin "+"; para la persona se muestra con "+". */
export function numeroLegible(waId: string): string {
  return `+${waId}`;
}

/** Tamano maximo de un aviso de Meta: lo documenta Meta (3 MB). La ruta y el RPC aplican el mismo tope. */
export const LIMITE_CUERPO_WEBHOOK_BYTES = 3 * 1024 * 1024;

/** Largo maximo de un texto de WhatsApp (text.body), segun la referencia de Meta. */
export const TEXTO_MAXIMO_WHATSAPP = 4096;

/** Codigos PROPIOS (no son de Meta) que se guardan en error_codigo de un envio fallido. */
export const CODIGO_SIN_CONFIGURAR = -1;
export const CODIGO_RESPUESTA_INESPERADA = -2;

const ETIQUETA_TIPO: Record<string, string> = {
  image: "[Imagen]",
  audio: "[Audio]",
  video: "[Video]",
  document: "[Documento]",
  sticker: "[Sticker]",
  location: "[Ubicación]",
  contacts: "[Contacto]",
  reaction: "[Reacción]",
  order: "[Pedido]",
  system: "[Aviso de WhatsApp]",
  interactive: "[Respuesta a botón]",
  button: "[Respuesta a botón]",
  unsupported: "[Mensaje no compatible con la bandeja]",
  unknown: "[Mensaje no compatible con la bandeja]",
};

/** Texto que se pinta de un mensaje: el suyo, o el tipo cuando no trae texto. */
export function textoDeMensaje(m: { tipo: string; texto: string | null }): string {
  if (m.texto) return m.tipo === "text" ? m.texto : `${ETIQUETA_TIPO[m.tipo] ?? "[Adjunto]"} ${m.texto}`;
  return ETIQUETA_TIPO[m.tipo] ?? "[Adjunto]";
}

const RE_TIPO_ENTRE_CORCHETES = /^\[([a-z]+)\]$/;

/**
 * El extracto que guarda la base para la lista (ultimo_mensaje_texto) lleva el
 * tipo de Meta en ingles entre corchetes cuando no hay texto ("[image]"); aqui
 * se traduce para que la lista y el hilo digan lo mismo.
 */
export function etiquetaUltimoMensaje(texto: string | null | undefined): string {
  if (!texto) return "Sin mensajes todavía";
  const tipo = RE_TIPO_ENTRE_CORCHETES.exec(texto)?.[1];
  if (!tipo) return texto;
  return ETIQUETA_TIPO[tipo] ?? "[Adjunto]";
}

/**
 * Que le decimos a la persona segun el codigo de Meta (tabla oficial de
 * errores de la Cloud API) o nuestro. Es lo UNICO que llega al navegador de
 * un envio fallido: el detalle crudo (ingles, fbtrace) se queda en la base y en
 * Sentry.
 */
export function mensajeParaUsuario(codigo: number | null | undefined): string {
  switch (codigo) {
    case CODIGO_SIN_CONFIGURAR:
      return "El envío por WhatsApp aún no está configurado en el servidor. Avisa al equipo de VICINO.";
    case CODIGO_RESPUESTA_INESPERADA:
      return "No se pudo enviar por un error interno de VICINO. Avisa al equipo.";
    case 131047:
      return "Pasaron más de 24 horas desde el último mensaje del cliente; WhatsApp ya no permite responder con texto libre.";
    case 131030:
      return "Ese número no está en la lista de destinatarios de prueba de Meta (el número de prueba solo escribe a números autorizados).";
    case 131026:
      return "WhatsApp no pudo entregar el mensaje: el número no tiene WhatsApp o usa una versión muy antigua.";
    case 131056:
      return "WhatsApp limita a un mensaje cada pocos segundos por cliente. Espera un momento e intenta de nuevo.";
    case 130429:
    case 80007:
    case 4:
      return "WhatsApp está limitando los envíos de este número en este momento. Intenta en un momento.";
    case 131048:
    case 131049:
      return "WhatsApp frenó este envío por sus límites de calidad. Intenta más tarde.";
    case 131021:
      return "No puedes escribirte a tu propio número de WhatsApp.";
    case 131031:
      return "La cuenta de WhatsApp Business está restringida por Meta. Revisa WhatsApp Manager.";
    case 131042:
      return "Meta reporta un problema con el método de pago de la cuenta de WhatsApp Business.";
    case 0:
    case 190:
      return "El token de acceso de WhatsApp expiró o no es válido. Hay que renovarlo en Meta.";
    case 3:
    case 10:
    case 200:
      return "La app de Meta no tiene permiso para enviar con este número (falta whatsapp_business_messaging).";
    case 100:
      return "Meta rechazó la solicitud por un dato inválido.";
    case 131016:
    case 131000:
      return "WhatsApp tuvo un error temporal. Intenta de nuevo en un momento.";
    case null:
    case undefined:
      return "No hubo respuesta de WhatsApp. Revisa tu conexión e intenta de nuevo.";
    default:
      return `WhatsApp no aceptó el mensaje (código ${codigo}).`;
  }
}

/** Para un envio que no se pudo CONFIRMAR (red, tiempo agotado): no invita a reenviar. */
export const MENSAJE_SIN_CONFIRMAR =
  "No se pudo confirmar el envío: puede haber salido. Espera un momento antes de volver a mandarlo; si WhatsApp lo entregó, aquí aparecerá la palomita.";
