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

export const CANALES_ENLACE_NEGOCIO = ["instagram", "whatsapp", "google_maps", "google_resenas"] as const;
export type CanalEnlaceNegocio = (typeof CANALES_ENLACE_NEGOCIO)[number];

export interface EnlacesNegocio {
  instagram_usuario: string | null;
  whatsapp_numero: string | null;
  google_maps_url: string | null;
  google_resenas_url: string | null;
}

export const INSTAGRAM_USUARIO_MAX = 30;
/** Letras, numeros, guion bajo y puntos; ningun punto al final ni dos seguidos. */
export const INSTAGRAM_USUARIO_REGEX = /^(?:[A-Za-z0-9_]|\.(?=[A-Za-z0-9_]))+$/;
/**
 * E.164 sin "+": de 10 a 15 digitos, sin cero inicial. El minimo de 10 (y no
 * 8) corta la forma mas comun de enlace roto en Mexico: un numero local sin
 * lada de pais. La lada NO se rellena: seria inventar un dato.
 */
export const WHATSAPP_NUMERO_REGEX = /^[1-9][0-9]{9,14}$/;
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
 * "00522221234567" devuelven "522221234567". Un numero sin lada de pais de 10
 * digitos PASA (no hay forma de saber que le falta): por eso la interfaz pide
 * la lada en voz alta en vez de adivinarla.
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
  if (valor.length > GOOGLE_MAPS_URL_MAX || /\s/.test(valor)) return null;
  if (RUTA_SOSPECHOSA_REGEX.test(valor)) return null;
  if (!GOOGLE_MAPS_URL_REGEX.test(valor)) return null;
  return valor;
}

/** Solo el enlace que genera Google en el Perfil de Negocio. Nada mas. */
export function normalizarUrlResenasGoogle(entrada: string): string | null {
  const valor = conHttpsYHostEnMinusculas(entrada.trim());
  if (valor.length > GOOGLE_RESENAS_URL_MAX) return null;
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
  return Boolean(
    enlaces.instagram_usuario || enlaces.whatsapp_numero || enlaces.google_maps_url || enlaces.google_resenas_url,
  );
}

export interface EnlaceNegocioListo {
  canal: CanalEnlaceNegocio;
  href: string;
  etiqueta: string;
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
  opciones: { incluirResenas: boolean },
): EnlaceNegocioListo[] {
  if (!enlaces) return [];
  const lista: EnlaceNegocioListo[] = [];
  if (enlaces.instagram_usuario) {
    lista.push({ canal: "instagram", href: urlInstagram(enlaces.instagram_usuario), etiqueta: "Instagram" });
  }
  if (enlaces.whatsapp_numero) {
    lista.push({ canal: "whatsapp", href: urlWhatsApp(enlaces.whatsapp_numero), etiqueta: "WhatsApp" });
  }
  if (enlaces.google_maps_url) {
    lista.push({ canal: "google_maps", href: enlaces.google_maps_url, etiqueta: "Google Maps" });
  }
  if (opciones.incluirResenas && enlaces.google_resenas_url) {
    lista.push({ canal: "google_resenas", href: enlaces.google_resenas_url, etiqueta: "Reseña en Google" });
  }
  return lista;
}
