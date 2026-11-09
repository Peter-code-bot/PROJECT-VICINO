/**
 * Redes sociales del negocio: Facebook (y Messenger), TikTok, YouTube, X,
 * LinkedIn, Threads, Pinterest y Telegram. Segunda entrega de los enlaces del
 * negocio (enlaces-negocio.ts), con la misma receta:
 *
 *   - Se LIMPIA lo que la persona escribe o pega (usuario suelto, con @, o la
 *     URL de su perfil con parametros de rastreo) y se guarda solo el dato: el
 *     usuario, o la ruta corta del perfil en Facebook, YouTube y LinkedIn.
 *   - Se ARMA la URL con el formato oficial de cada red (fuentes leidas el
 *     8-nov-2026, en docs/REDES-NEGOCIO-2026-11-08.md).
 *
 * Los patrones se repiten tal cual en la migracion
 * 20261108230000_mas_redes_del_negocio.sql (CHECK + guardar_enlaces_negocio).
 * Si divergen, la persona ve un error distinto segun donde se valide. Excepcion
 * deliberada: el @handle de YouTube, que admite letras de cualquier idioma; aqui
 * se valida completo y en Postgres con una regla mas laxa (ver la migracion).
 *
 * Los enlaces cortos (vm.tiktok.com, lnkd.in, pin.it, youtu.be...) se RECHAZAN:
 * esconden el destino y resolverlos obligaria al servidor a seguir
 * redirecciones de terceros. El mensaje dice donde ver el usuario.
 */

export type MotivoRechazoRed = "formato" | "otro_sitio" | "enlace_corto" | "no_es_perfil";
export type ResultadoRed = { ok: true; valor: string } | { ok: false; motivo: MotivoRechazoRed };

const ok = (valor: string): ResultadoRed => ({ ok: true, valor });
const rechazo = (motivo: MotivoRechazoRed): ResultadoRed => ({ ok: false, motivo });

interface UrlPegada {
  host: string;
  segmentos: string[];
  params: URLSearchParams;
}

/**
 * Si lo que pego la persona parece una URL (trae esquema o una "/"), la parte en
 * host, segmentos de ruta (decodificados) y parametros. Devuelve null si no
 * parece URL (es un usuario suelto) y "invalida" si parece URL pero no se puede
 * leer o trae credenciales o puerto.
 */
function leerUrlPegada(entrada: string): UrlPegada | null | "invalida" {
  const valor = entrada.trim();
  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(valor);
  if (!conEsquema && !valor.includes("/")) return null;
  if (conEsquema && !/^https?:\/\//i.test(valor)) return "invalida";
  let url: URL;
  try {
    url = new URL(conEsquema ? valor : `https://${valor}`);
  } catch {
    return "invalida";
  }
  if (url.username || url.password || url.port) return "invalida";
  const segmentos: string[] = [];
  for (const crudo of url.pathname.split("/")) {
    if (!crudo) continue;
    try {
      segmentos.push(decodeURIComponent(crudo));
    } catch {
      return "invalida";
    }
  }
  return { host: url.hostname.toLowerCase(), segmentos, params: url.searchParams };
}

function sinArroba(entrada: string): string {
  return entrada.trim().replace(/^@/, "");
}

// ── Facebook ────────────────────────────────────────────────────────────────

export const FACEBOOK_USUARIO_REGEX = /^[a-z0-9.]{5,50}$/;
export const FACEBOOK_ID_REGEX = /^[0-9]{5,20}$/;
const FACEBOOK_PREFIJO_ID = "profile.php?id=";
const HOSTS_FACEBOOK = /^(?:(?:www|m|web|mbasic|touch|business|[a-z]{2}-[a-z]{2})\.)?facebook\.com$|^(?:www\.)?fb\.com$/;
const HOSTS_CORTOS_FACEBOOK = /^(?:www\.)?fb\.me$/;
/** Rutas de Facebook que no son una pagina ni un perfil. */
const RUTAS_NO_PERFIL_FACEBOOK = new Set([
  "share", "sharer", "sharer.php", "groups", "pages", "watch", "marketplace", "events", "photo", "photo.php",
  "photos", "reel", "reels", "videos", "video.php", "gaming", "login", "login.php", "help", "hashtag", "stories",
  "story.php", "permalink.php", "dialog", "plugins", "ads", "settings", "messages", "notifications", "friends",
  "search", "home.php", "l.php", "profile",
]);

function usuarioFacebook(valor: string): ResultadoRed {
  const usuario = valor.toLowerCase();
  // Ni los puntos ni las mayusculas distinguen usuarios en Facebook; se guarda
  // en minusculas para que la ficha siempre se vea igual. Al menos una letra:
  // solo digitos es un ID, no un usuario.
  if (!FACEBOOK_USUARIO_REGEX.test(usuario) || !/[a-z]/.test(usuario)) return rechazo("formato");
  if (RUTAS_NO_PERFIL_FACEBOOK.has(usuario)) return rechazo("no_es_perfil");
  return ok(usuario);
}

function idFacebook(valor: string | null | undefined): ResultadoRed {
  if (!valor || !FACEBOOK_ID_REGEX.test(valor)) return rechazo("formato");
  return ok(`${FACEBOOK_PREFIJO_ID}${valor}`);
}

/**
 * "mitienda", "@MiTienda", "facebook.com/MiTienda?mibextid=x" -> "mitienda".
 * "facebook.com/profile.php?id=61550000000000", "facebook.com/people/Mi-Tienda/61550000000000/"
 * y "61550000000000" -> "profile.php?id=61550000000000" (paginas sin usuario).
 * "facebook.com/share/…" se rechaza: no se sabe a donde lleva (decision 3 del plan).
 */
export function normalizarFacebook(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  if (url) {
    if (HOSTS_CORTOS_FACEBOOK.test(url.host)) return rechazo("enlace_corto");
    if (!HOSTS_FACEBOOK.test(url.host)) return rechazo("otro_sitio");
    const [primero, segundo, tercero] = url.segmentos;
    if (!primero) return rechazo("no_es_perfil");
    if (primero === "profile.php") return idFacebook(url.params.get("id"));
    if (primero === "people" && segundo && tercero) return idFacebook(tercero);
    if (/^[0-9]+$/.test(primero)) return idFacebook(primero);
    if (RUTAS_NO_PERFIL_FACEBOOK.has(primero.toLowerCase())) return rechazo("no_es_perfil");
    return usuarioFacebook(primero);
  }
  const valor = sinArroba(entrada);
  if (/^[0-9]+$/.test(valor)) return idFacebook(valor);
  return usuarioFacebook(valor);
}

export function esIdFacebook(ruta: string): boolean {
  return ruta.startsWith(FACEBOOK_PREFIJO_ID);
}

export function urlFacebook(ruta: string): string {
  if (esIdFacebook(ruta)) {
    return `https://www.facebook.com/profile.php?id=${encodeURIComponent(ruta.slice(FACEBOOK_PREFIJO_ID.length))}`;
  }
  return `https://www.facebook.com/${encodeURIComponent(ruta)}`;
}

/** m.me con el usuario de Facebook; `text` lo documenta Meta para paginas. */
export function urlMessenger(usuarioFacebook: string, texto?: string): string {
  const base = `https://m.me/${encodeURIComponent(usuarioFacebook)}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

// ── TikTok ──────────────────────────────────────────────────────────────────

/** 2 a 24: letras, numeros, guion bajo y puntos; sin punto al final. */
export const TIKTOK_USUARIO_REGEX = /^[A-Za-z0-9_.]{1,23}[A-Za-z0-9_]$/;
const HOSTS_TIKTOK = /^(?:www\.|m\.)?tiktok\.com$/;
const HOSTS_CORTOS_TIKTOK = /^(?:vm|vt)\.tiktok\.com$/;

export function normalizarTikTok(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  let usuario: string;
  if (url) {
    if (HOSTS_CORTOS_TIKTOK.test(url.host)) return rechazo("enlace_corto");
    if (!HOSTS_TIKTOK.test(url.host)) return rechazo("otro_sitio");
    const primero = url.segmentos[0] ?? "";
    if (primero === "t") return rechazo("enlace_corto");
    if (!primero.startsWith("@")) return rechazo("no_es_perfil");
    usuario = primero.slice(1);
  } else {
    usuario = sinArroba(entrada);
  }
  // Las mayusculas no estan confirmadas como indistintas: se guarda tal cual.
  return TIKTOK_USUARIO_REGEX.test(usuario) ? ok(usuario) : rechazo("formato");
}

export function urlTikTok(usuario: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(usuario)}`;
}

// ── YouTube ─────────────────────────────────────────────────────────────────

export const YOUTUBE_CANAL_REGEX = /^UC[A-Za-z0-9_-]{22}$/;
/**
 * @handle: 3 a 30 caracteres; letras de cualquier idioma (con sus acentos),
 * numeros, y `_ - . ·`, que no pueden ir al principio ni al final.
 */
const YOUTUBE_HANDLE_REGEX = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_.\-·]*[\p{L}\p{M}\p{N}]$/u;
const HOSTS_YOUTUBE = /^(?:www\.|m\.)?youtube\.com$/;
const HOSTS_VIDEO_YOUTUBE = /^(?:www\.)?youtu\.be$/;

function handleYouTube(valor: string): ResultadoRed {
  const handle = valor.normalize("NFC").toLowerCase();
  const largo = [...handle].length;
  if (largo < 3 || largo > 30 || !YOUTUBE_HANDLE_REGEX.test(handle)) return rechazo("formato");
  return ok(`@${handle}`);
}

/**
 * "@MiCanal", "micanal", "youtube.com/@MiCanal?si=x" -> "@micanal".
 * "youtube.com/channel/UC…" -> "channel/UC…". Los enlaces de video (youtu.be,
 * /watch, /shorts) y las URL antiguas (/c/, /user/) se rechazan pidiendo el @.
 */
export function normalizarYouTube(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  if (url) {
    if (HOSTS_VIDEO_YOUTUBE.test(url.host)) return rechazo("no_es_perfil");
    if (!HOSTS_YOUTUBE.test(url.host)) return rechazo("otro_sitio");
    const [primero, segundo] = url.segmentos;
    if (primero?.startsWith("@")) return handleYouTube(primero.slice(1));
    if (primero === "channel" && segundo) {
      return YOUTUBE_CANAL_REGEX.test(segundo) ? ok(`channel/${segundo}`) : rechazo("formato");
    }
    return rechazo("no_es_perfil");
  }
  const valor = entrada.trim();
  if (YOUTUBE_CANAL_REGEX.test(valor)) return ok(`channel/${valor}`);
  return handleYouTube(sinArroba(valor));
}

export function urlYouTube(ruta: string): string {
  if (ruta.startsWith("channel/")) {
    return `https://www.youtube.com/channel/${encodeURIComponent(ruta.slice("channel/".length))}`;
  }
  return `https://www.youtube.com/@${encodeURIComponent(ruta.replace(/^@/, ""))}`;
}

// ── X (antes Twitter) ───────────────────────────────────────────────────────

export const X_USUARIO_REGEX = /^[A-Za-z0-9_]{1,15}$/;
const HOSTS_X = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/;
const RUTAS_NO_PERFIL_X = new Set([
  "i", "home", "search", "explore", "intent", "share", "hashtag", "messages", "settings", "notifications",
  "compose", "login", "signup", "tos", "privacy", "about",
]);

export function normalizarX(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  let usuario: string;
  if (url) {
    if (!HOSTS_X.test(url.host)) return rechazo("otro_sitio");
    const primero = url.segmentos[0];
    if (!primero || RUTAS_NO_PERFIL_X.has(primero.toLowerCase())) return rechazo("no_es_perfil");
    usuario = primero;
  } else {
    usuario = sinArroba(entrada);
  }
  return X_USUARIO_REGEX.test(usuario) ? ok(usuario) : rechazo("formato");
}

export function urlX(usuario: string): string {
  return `https://x.com/${encodeURIComponent(usuario)}`;
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

const LINKEDIN_PERFIL_REGEX = /^[a-z0-9-]{3,100}$/;
const LINKEDIN_EMPRESA_REGEX = /^[a-z0-9-]{2,100}$/;
const HOSTS_LINKEDIN = /^(?:(?:www|[a-z]{2})\.)?linkedin\.com$/;
const HOSTS_CORTOS_LINKEDIN = /^lnkd\.in$/;

function rutaLinkedIn(tipo: string, slug: string | undefined): ResultadoRed {
  if (!slug) return rechazo("formato");
  const limpio = slug.toLowerCase();
  if (tipo === "in") return LINKEDIN_PERFIL_REGEX.test(limpio) ? ok(`in/${limpio}`) : rechazo("formato");
  if (tipo === "company") return LINKEDIN_EMPRESA_REGEX.test(limpio) ? ok(`company/${limpio}`) : rechazo("formato");
  return rechazo("no_es_perfil");
}

/**
 * Perfil (linkedin.com/in/…) o pagina de empresa (linkedin.com/company/…), las
 * dos aceptadas (decision de Alejandro, 8-nov-2026). Sin la URL no se sabe cual
 * de las dos es, asi que un nombre suelto se rechaza pidiendo el enlace.
 */
export function normalizarLinkedIn(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  if (!url) return rechazo("formato");
  if (HOSTS_CORTOS_LINKEDIN.test(url.host)) return rechazo("enlace_corto");
  if (!HOSTS_LINKEDIN.test(url.host)) {
    // "in/mi-perfil" o "company/mi-empresa" sin dominio.
    const crudo = entrada.trim().replace(/^\/+/, "").split(/[?#]/)[0] ?? "";
    const [tipo, slug, ...resto] = crudo.split("/").filter(Boolean);
    if (resto.length === 0 && (tipo === "in" || tipo === "company")) return rutaLinkedIn(tipo, slug);
    return rechazo("otro_sitio");
  }
  const [tipo, slug] = url.segmentos;
  return rutaLinkedIn(tipo ?? "", slug);
}

export function urlLinkedIn(ruta: string): string {
  const [tipo, slug] = ruta.split("/");
  return `https://www.linkedin.com/${tipo === "company" ? "company" : "in"}/${encodeURIComponent(slug ?? "")}/`;
}

// ── Threads ─────────────────────────────────────────────────────────────────

/** Las reglas de Instagram: Threads no publica las suyas. */
export const THREADS_USUARIO_REGEX = /^(?:[a-z0-9_]|\.(?=[a-z0-9_]))+$/;
const HOSTS_THREADS = /^(?:www\.)?threads\.(?:com|net)$/;

export function normalizarThreads(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  let usuario: string;
  if (url) {
    if (!HOSTS_THREADS.test(url.host)) return rechazo("otro_sitio");
    const primero = url.segmentos[0] ?? "";
    if (!primero.startsWith("@")) return rechazo("no_es_perfil");
    usuario = primero.slice(1);
  } else {
    usuario = sinArroba(entrada);
  }
  usuario = usuario.toLowerCase();
  if (usuario.length < 1 || usuario.length > 30 || !THREADS_USUARIO_REGEX.test(usuario)) return rechazo("formato");
  return ok(usuario);
}

export function urlThreads(usuario: string): string {
  return `https://www.threads.com/@${encodeURIComponent(usuario)}`;
}

// ── Pinterest ───────────────────────────────────────────────────────────────

export const PINTEREST_USUARIO_REGEX = /^[A-Za-z0-9_]{3,30}$/;
const HOSTS_PINTEREST = /^(?:(?:www|[a-z]{2})\.)?pinterest\.com(?:\.mx)?$/;
const HOSTS_CORTOS_PINTEREST = /^pin\.it$/;
const RUTAS_NO_PERFIL_PINTEREST = new Set(["pin", "ideas", "search", "today", "_", "business", "settings", "login"]);

export function normalizarPinterest(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  let usuario: string;
  if (url) {
    if (HOSTS_CORTOS_PINTEREST.test(url.host)) return rechazo("enlace_corto");
    if (!HOSTS_PINTEREST.test(url.host)) return rechazo("otro_sitio");
    const primero = url.segmentos[0];
    if (!primero || RUTAS_NO_PERFIL_PINTEREST.has(primero.toLowerCase())) return rechazo("no_es_perfil");
    usuario = primero;
  } else {
    usuario = sinArroba(entrada);
  }
  if (!PINTEREST_USUARIO_REGEX.test(usuario) || !/[A-Za-z_]/.test(usuario)) return rechazo("formato");
  return ok(usuario);
}

export function urlPinterest(usuario: string): string {
  return `https://www.pinterest.com/${encodeURIComponent(usuario)}/`;
}

// ── Telegram ────────────────────────────────────────────────────────────────

export const TELEGRAM_USUARIO_REGEX = /^[a-z0-9_]{5,32}$/;
const HOSTS_TELEGRAM = /^(?:www\.)?(?:t\.me|telegram\.me)$/;
const RUTAS_NO_PERFIL_TELEGRAM = new Set(["joinchat", "s", "c", "addstickers", "addemoji", "share", "proxy", "socks", "iv", "login"]);

export function normalizarTelegram(entrada: string): ResultadoRed {
  const url = leerUrlPegada(entrada);
  if (url === "invalida") return rechazo("formato");
  let usuario: string;
  if (url) {
    if (!HOSTS_TELEGRAM.test(url.host)) return rechazo("otro_sitio");
    const primero = url.segmentos[0];
    // t.me/+… son invitaciones a grupos privados o numeros de telefono.
    if (!primero || primero.startsWith("+") || RUTAS_NO_PERFIL_TELEGRAM.has(primero.toLowerCase())) {
      return rechazo("no_es_perfil");
    }
    usuario = primero;
  } else {
    usuario = sinArroba(entrada);
  }
  usuario = usuario.toLowerCase();
  return TELEGRAM_USUARIO_REGEX.test(usuario) ? ok(usuario) : rechazo("formato");
}

export function urlTelegram(usuario: string): string {
  return `https://t.me/${encodeURIComponent(usuario)}`;
}
