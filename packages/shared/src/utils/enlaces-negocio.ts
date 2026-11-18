/**
 * Enlaces de contacto del negocio: Instagram, WhatsApp, Google Maps y resenas
 * de Google. Solo enlaces SALIENTES desde la ficha publica del vendedor.
 *
 * Aqui viven las dos mitades que tienen que coincidir siempre:
 *
 *   - Como se LIMPIA lo que la persona escribe (pega una URL completa, un @,
 *     un numero con espacios y parentesis) para guardar solo el dato.
 *   - Como se ARMA la URL que se abre, con el formato que documenta cada
 *     proveedor:
 *       Instagram  https://www.instagram.com/<usuario>/
 *       WhatsApp   https://wa.me/<numero>?text=<mensaje codificado>
 *                  (numero internacional sin "+", ceros, parentesis ni guiones;
 *                  faq.whatsapp.com/5913398998672934)
 *       Google Maps y resenas: la URL que el vendedor pego, acotada a dominios
 *                  de Google y https (developers.google.com/maps/documentation/urls).
 *
 * Los patrones se repiten tal cual en la migracion
 * 20261108120000_enlaces_de_contacto_del_negocio.sql (CHECK + RPC). Si
 * divergen, la persona ve un error distinto segun donde se valide.
 */

import {
  esIdFacebook,
  urlFacebook,
  urlLinkedIn,
  urlMessenger,
  urlPinterest,
  urlTelegram,
  urlThreads,
  urlTikTok,
  urlX,
  urlYouTube,
} from "./redes-negocio";

/**
 * Todos los canales, en el orden en que se pintan. Los cuatro primeros son de
 * 20261108120000; el resto, de 20261108230000 (redes-negocio.ts). La misma
 * lista vive en el CHECK de clics_enlaces_negocio y en
 * registrar_clic_enlace_negocio.
 */
export const CANALES_ENLACE_NEGOCIO = [
  "instagram",
  "whatsapp",
  "google_maps",
  "google_resenas",
  "facebook",
  "messenger",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "threads",
  "pinterest",
  "telegram",
] as const;
export type CanalEnlaceNegocio = (typeof CANALES_ENLACE_NEGOCIO)[number];

/** Canales para hablar con el negocio o llegar a el: se ven siempre, con texto. */
export const CANALES_CONTACTO: ReadonlyArray<CanalEnlaceNegocio> = ["whatsapp", "messenger", "google_maps", "google_resenas"];
/** Redes sociales: se pliegan en un solo chip cuando hay muchos botones. */
export const CANALES_REDES: ReadonlyArray<CanalEnlaceNegocio> = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "threads",
  "pinterest",
  "telegram",
];

export interface EnlacesNegocio {
  instagram_usuario: string | null;
  whatsapp_numero: string | null;
  google_maps_url: string | null;
  google_resenas_url: string | null;
  facebook_ruta: string | null;
  /** Ofrecer Messenger con el usuario de Facebook. */
  facebook_messenger: boolean | null;
  tiktok_usuario: string | null;
  youtube_ruta: string | null;
  x_usuario: string | null;
  linkedin_ruta: string | null;
  threads_usuario: string | null;
  pinterest_usuario: string | null;
  telegram_usuario: string | null;
}

/** Las columnas de texto de los enlaces, en el orden del formulario. */
export const CAMPOS_TEXTO_ENLACES_NEGOCIO = [
  "instagram_usuario",
  "whatsapp_numero",
  "google_maps_url",
  "google_resenas_url",
  "facebook_ruta",
  "tiktok_usuario",
  "youtube_ruta",
  "x_usuario",
  "linkedin_ruta",
  "threads_usuario",
  "pinterest_usuario",
  "telegram_usuario",
] as const;
export type CampoTextoEnlaceNegocio = (typeof CAMPOS_TEXTO_ENLACES_NEGOCIO)[number];

export const INSTAGRAM_USUARIO_MAX = 30;
/** Letras, numeros, guion bajo y puntos; ningun punto al final ni dos seguidos. */
export const INSTAGRAM_USUARIO_REGEX = /^(?:[A-Za-z0-9_]|\.(?=[A-Za-z0-9_]))+$/;
/**
 * E.164 sin "+": de 11 a 15 digitos, sin cero inicial. El minimo de 11 corta
 * la forma mas comun de enlace roto en Mexico: un numero local de 10 digitos
 * sin lada de pais (52 + 10 = 12). Se RECHAZA con mensaje, no se rellena la
 * lada: rellenarla seria inventar un dato. Precio asumido: un numero
 * internacional legitimo de 10 digitos en total (raro para un negocio de
 * Puebla) no entra.
 */
export const WHATSAPP_NUMERO_REGEX = /^[1-9][0-9]{10,14}$/;
export const GOOGLE_MAPS_URL_MAX = 500;
/**
 * Lista CERRADA de hosts: google.com y google.com.mx (con o sin www) solo bajo
 * /maps, maps.google.com(.mx), el acortador de la app (maps.app.goo.gl), el
 * acortador viejo (goo.gl/maps) y g.page. Un comodin de TLD (google.xyz) dejaria
 * pasar dominios que no son de Google.
 */
export const GOOGLE_MAPS_URL_REGEX =
  /^https:\/\/((www\.)?google\.com(\.mx)?\/maps([/?]|$)|maps\.google\.com(\.mx)?\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.page\/)/;
/**
 * Segmentos "." o ".." (tambien codificados) y barras invertidas: el navegador
 * los normaliza DESPUES de que el regex vio "/maps/", asi que
 * google.com/maps/../url?q=... acabaria fuera de Maps. Se rechazan en seco.
 */
export const RUTA_SOSPECHOSA_REGEX = /(\/\.|%2e|\\)/i;
/**
 * Puntos de codigo que no van en una URL guardada: controles (incluido NUL,
 * que Postgres ni siquiera puede almacenar), DEL, y todos los espacios
 * Unicode. Es una lista EXPLICITA y no `\s` porque el `\s` de JavaScript y el
 * de Postgres no cubren el mismo conjunto (U+0085, y en Postgres depende del
 * locale): con la lista, los dos lados rechazan exactamente lo mismo. La
 * migracion repite la misma clase desde \u0001.
 */
export const CARACTER_PROHIBIDO_URL_REGEX =
  /[\u0000-\u0020\u007F-\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]/;
export const GOOGLE_RESENAS_URL_MAX = 300;
/** Solo las dos formas que genera Google: g.page/r/<id>/review y writereview?placeid=. */
export const GOOGLE_RESENAS_URL_REGEX =
  /^https:\/\/(g\.page\/(r\/)?[A-Za-z0-9_-]+\/review\/?|search\.google\.com\/local\/writereview\?placeid=[A-Za-z0-9_-]+)$/;

/** Lo que recibe el negocio al abrirse el chat: le dice de donde viene la persona. */
export const TEXTO_WHATSAPP_DESDE_VICINO = "Hola, vi tu negocio en VICINO y me interesa.";

const INSTAGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i;
const WHATSAPP_URL = /^(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)([0-9+()\-\s.]+)/i;

/**
 * "@Mi.Tienda", "instagram.com/mi.tienda/?igsh=x" y "mi.tienda" devuelven
 * "mi.tienda". Instagram no distingue mayusculas, asi que se guarda en
 * minusculas y la ficha siempre se ve igual. Devuelve null si no es un usuario
 * valido: el llamador decide el mensaje.
 */
export function normalizarUsuarioInstagram(entrada: string): string | null {
  let valor = entrada.trim();
  const desdeUrl = INSTAGRAM_URL.exec(valor)?.[1];
  if (desdeUrl) valor = desdeUrl;
  valor = valor.replace(/^@/, "");
  if (valor.length === 0 || valor.length > INSTAGRAM_USUARIO_MAX) return null;
  if (!INSTAGRAM_USUARIO_REGEX.test(valor)) return null;
  return valor.toLowerCase();
}

/**
 * "+52 (222) 123-4567", "52 222 123 4567", "wa.me/522221234567" y
 * "00522221234567" devuelven "522221234567". Un numero local de 10 digitos sin
 * lada ("2221234567") devuelve null: se rechaza con mensaje, no se adivina.
 */
export function normalizarNumeroWhatsApp(entrada: string): string | null {
  let valor = entrada.trim();
  const desdeUrl = WHATSAPP_URL.exec(valor)?.[1];
  if (desdeUrl) valor = desdeUrl;
  const digitos = valor
    .replace(/[\s().\-]/g, "")
    .replace(/^\+/, "")
    .replace(/^00/, "");
  if (!WHATSAPP_NUMERO_REGEX.test(digitos)) return null;
  return digitos;
}

/**
 * Pone https (o sube http a https) y baja a minusculas SOLO el host: el esquema
 * y el dominio no distinguen mayusculas, pero la ruta de Maps si (ids de lugar,
 * nombres codificados), y hay que dejarla intacta.
 */
function conHttpsYHostEnMinusculas(valor: string): string {
  const sinEsquema = valor.replace(/^https?:\/\//i, "");
  const finHost = sinEsquema.search(/[/?#]/);
  const host = (finHost === -1 ? sinEsquema : sinEsquema.slice(0, finHost)).toLowerCase();
  const resto = finHost === -1 ? "" : sinEsquema.slice(finHost);
  return `https://${host}${resto}`;
}

/**
 * Acepta la URL tal como la copia la app de Maps (maps.app.goo.gl, google.com/maps,
 * google.com.mx/maps, g.page). Si falta el esquema lo pone; http se sube a
 * https. Cualquier otro dominio, o una ruta con "..", devuelve null.
 */
export function normalizarUrlGoogleMaps(entrada: string): string | null {
  const valor = conHttpsYHostEnMinusculas(entrada.trim());
  if (valor.length > GOOGLE_MAPS_URL_MAX) return null;
  if (CARACTER_PROHIBIDO_URL_REGEX.test(valor)) return null;
  if (RUTA_SOSPECHOSA_REGEX.test(valor)) return null;
  if (!GOOGLE_MAPS_URL_REGEX.test(valor)) return null;
  return valor;
}

/** Solo el enlace que genera Google en el Perfil de Negocio. Nada mas. */
export function normalizarUrlResenasGoogle(entrada: string): string | null {
  const valor = conHttpsYHostEnMinusculas(entrada.trim());
  if (valor.length > GOOGLE_RESENAS_URL_MAX) return null;
  if (CARACTER_PROHIBIDO_URL_REGEX.test(valor)) return null;
  if (RUTA_SOSPECHOSA_REGEX.test(valor)) return null;
  if (!GOOGLE_RESENAS_URL_REGEX.test(valor)) return null;
  return valor;
}

export function urlInstagram(usuario: string): string {
  return `https://www.instagram.com/${encodeURIComponent(usuario)}/`;
}

export function urlWhatsApp(numero: string, texto: string = TEXTO_WHATSAPP_DESDE_VICINO): string {
  const base = `https://wa.me/${numero}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

export function tieneEnlacesNegocio(enlaces: Partial<EnlacesNegocio> | null | undefined): boolean {
  if (!enlaces) return false;
  // facebook_messenger no cuenta solo: sin facebook_ruta no hay a donde mandar.
  return CAMPOS_TEXTO_ENLACES_NEGOCIO.some((campo) => Boolean(enlaces[campo]));
}

export interface EnlaceNegocioListo {
  canal: CanalEnlaceNegocio;
  href: string;
  etiqueta: string;
  grupo: "contacto" | "redes";
}

export const ETIQUETAS_CANAL_ENLACE_NEGOCIO: Readonly<Record<CanalEnlaceNegocio, string>> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_maps: "Google Maps",
  google_resenas: "Reseña en Google",
  facebook: "Facebook",
  messenger: "Messenger",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
  pinterest: "Pinterest",
  telegram: "Telegram",
};

/**
 * Regla de diseño de Alejandro (8-nov-2026): con 4 chips o más, las redes
 * sociales se pliegan en UN solo chip desplegable, «Redes sociales». Los de
 * contacto (WhatsApp, Messenger, Maps, reseña) siguen a la vista: son los que
 * llevan a hablar con el negocio. Con una sola red no se pliega: un
 * desplegable con un solo elemento solo agrega un toque.
 */
export const UMBRAL_REDES_DESPLEGABLES = 4;

export function agruparEnlacesNegocio(lista: ReadonlyArray<EnlaceNegocioListo>): {
  visibles: EnlaceNegocioListo[];
  redesPlegadas: EnlaceNegocioListo[] | null;
} {
  const redes = lista.filter((e) => e.grupo === "redes");
  if (lista.length >= UMBRAL_REDES_DESPLEGABLES && redes.length >= 2) {
    return { visibles: lista.filter((e) => e.grupo === "contacto"), redesPlegadas: redes };
  }
  return { visibles: [...lista], redesPlegadas: null };
}

/**
 * Los enlaces que se pintan, en el orden en que se pintan. La resena de Google
 * solo entra con `incluirResenas`: la ficha la ofrece a quien ya compro (o al
 * dueno, para que vea que funciona), nunca a cualquiera que pase. Es la regla
 * de Google de no pedir resenas de forma selectiva ni a cambio de algo, y la
 * de VICINO de que la resena de la compra se escribe dentro de VICINO.
 */
export function listarEnlacesNegocio(
  enlaces: Partial<EnlacesNegocio> | null | undefined,
  opciones: { incluirResenas: boolean; urlPerfil?: string },
): EnlaceNegocioListo[] {
  if (!enlaces) return [];
  const mensaje = opciones.urlPerfil
    ? `${TEXTO_WHATSAPP_DESDE_VICINO}\n\n${opciones.urlPerfil}`
    : TEXTO_WHATSAPP_DESDE_VICINO;
  const hrefs: Partial<Record<CanalEnlaceNegocio, string>> = {};
  if (enlaces.whatsapp_numero) hrefs.whatsapp = urlWhatsApp(enlaces.whatsapp_numero, mensaje);
  // Messenger cuelga del usuario de Facebook; con un ID numerico no hay m.me.
  if (enlaces.facebook_messenger && enlaces.facebook_ruta && !esIdFacebook(enlaces.facebook_ruta)) {
    hrefs.messenger = urlMessenger(enlaces.facebook_ruta, mensaje);
  }
  if (enlaces.google_maps_url) hrefs.google_maps = enlaces.google_maps_url;
  if (opciones.incluirResenas && enlaces.google_resenas_url) hrefs.google_resenas = enlaces.google_resenas_url;
  if (enlaces.instagram_usuario) hrefs.instagram = urlInstagram(enlaces.instagram_usuario);
  if (enlaces.facebook_ruta) hrefs.facebook = urlFacebook(enlaces.facebook_ruta);
  if (enlaces.tiktok_usuario) hrefs.tiktok = urlTikTok(enlaces.tiktok_usuario);
  if (enlaces.youtube_ruta) hrefs.youtube = urlYouTube(enlaces.youtube_ruta);
  if (enlaces.x_usuario) hrefs.x = urlX(enlaces.x_usuario);
  if (enlaces.linkedin_ruta) hrefs.linkedin = urlLinkedIn(enlaces.linkedin_ruta);
  if (enlaces.threads_usuario) hrefs.threads = urlThreads(enlaces.threads_usuario);
  if (enlaces.pinterest_usuario) hrefs.pinterest = urlPinterest(enlaces.pinterest_usuario);
  if (enlaces.telegram_usuario) hrefs.telegram = urlTelegram(enlaces.telegram_usuario);

  const lista: EnlaceNegocioListo[] = [];
  for (const [grupo, canales] of [
    ["contacto", CANALES_CONTACTO],
    ["redes", CANALES_REDES],
  ] as const) {
    for (const canal of canales) {
      const href = hrefs[canal];
      if (href) lista.push({ canal, href, etiqueta: ETIQUETAS_CANAL_ENLACE_NEGOCIO[canal], grupo });
    }
  }
  return lista;
}
