import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Extract the client IP from request/headers. Prefers x-forwarded-for
 * (first entry), falls back to x-real-ip, then "unknown".
 * Shared across middleware and server actions so the limit identifier
 * stays consistent — without this, an action that only checks
 * x-forwarded-for collapses every request lacking that header into a
 * single global quota.
 */
export function getClientIp(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// Boot strategy: if Upstash creds are absent (local dev without the .env
// vars, preview deploys before secrets are wired), build instances as null
// and treat enforce()/check() as no-ops. Production with creds gets real
// throttling. Never fail-closed on a missing dependency — that breaks devs.
const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = hasUpstash ? Redis.fromEnv() : null;

// Que la ausencia se oiga.
//
// La estrategia de arranque de arriba es correcta -- no romperle el entorno a
// nadie por una dependencia ausente -- pero tenia un agujero: en produccion, sin
// las credenciales, TODOS los limites de este archivo se vuelven un no-op y no
// lo dice nadie. El login queda sin freno contra fuerza bruta, las escrituras
// sin freno contra scripts, la busqueda sin freno contra scraping, y la unica
// senal es que no pasa nada.
//
// Comprobado el 27-ago-2026 contra vicinomarket.com: 48 peticiones seguidas a
// /auth/callback-server, cuyo limite declarado es 20/min por IP, devolvieron
// las 48 un 200. O sea que hoy esto es exactamente lo que describe el parrafo
// anterior.
//
// Se avisa desde dentro de enforce/check, no aqui arriba, a proposito: en el
// arranque de un modulo de Edge puede no haber Sentry inicializado todavia, y
// un aviso que se emite donde nadie lo recoge es el mismo problema otra vez.
let yaAvisado = false;

function avisarSiNoHayFreno(): void {
  if (hasUpstash || yaAvisado) return;
  // VERCEL_ENV y no NODE_ENV: NODE_ENV tambien vale "production" en cada build
  // de preview, asi que el preview alimentaba el mismo issue.
  if (process.env.VERCEL_ENV !== "production") return;
  yaAvisado = true;
  const mensaje =
    "[rate-limit] NO HAY LIMITE DE PETICIONES EN PRODUCCION: faltan " +
    "UPSTASH_REDIS_REST_URL y/o UPSTASH_REDIS_REST_TOKEN. Todos los limitadores " +
    "de lib/rate-limit.ts estan inactivos: login, escrituras, busqueda y reportes " +
    "aceptan peticiones sin freno.";
  console.error(mensaje);
  // Sentry se carga de forma perezosa para no atarlo al grafo del modulo, que
  // tambien se importa desde proxy.ts (runtime Edge).
  // Nivel "warning" y no "error" a proposito. `yaAvisado` es una variable de
  // modulo, o sea POR ISOLATE: en Vercel eso no es una vez por despliegue sino
  // una vez por arranque en frio, en los dos runtimes (Node y Edge) y en cada
  // region. Asi salieron 77 eventos en una semana, el 62% de todo el volumen de
  // errores del proyecto, para decir 77 veces lo mismo. Y no es un error de
  // ejecucion: es un hecho de configuracion del despliegue, que ademas ya queda
  // dicho una sola vez y de forma determinista en el guard de build
  // (scripts/check-rate-limit-env.mjs). Aqui se conserva la senal, pero fuera
  // del recuento de errores y de la regla de alerta.
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureMessage(mensaje, {
        level: "warning",
        tags: { runtime: process.env.NEXT_RUNTIME ?? "desconocido" },
      });
    })
    .catch(() => {
      // Si Sentry no esta disponible el console.error de arriba ya salio.
    });
}

function makeLimiter(window: Parameters<typeof Ratelimit.slidingWindow>[1], count: number, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(count, window),
    prefix,
    analytics: true,
  });
}

// Auth pages (login, register, forgot-password) — slow credential stuffing.
// Per IP. Tight ceiling on purpose; legitimate users rarely retry > 5 times.
export const authRateLimit = makeLimiter("15 m", 5, "rl:auth");

// OAuth callback — Supabase occasionally retries the callback in OAuth flows,
// so this gets its own, more permissive tier to avoid breaking legitimate
// retries. Per IP.
export const oauthCallbackRateLimit = makeLimiter("1 m", 20, "rl:oauth-cb");

// Authenticated write actions (createProduct, sendMessage, toggleFavorite,
// admin actions, etc.). Per user. 30/min is well above human pace but blocks
// scripted abuse.
export const writeRateLimit = makeLimiter("1 m", 30, "rl:write");

// Read receipts are background acknowledgements, not sends. Sharing the write
// quota would let incoming messages exhaust the user's ability to reply.
export const chatReadRateLimit = makeLimiter("1 m", 60, "rl:chat-read");

// Heavy reads (search, nearby_products). Per IP. 60/min is above any
// reasonable UI cadence; below scraping speeds.
export const readHeavyRateLimit = makeLimiter("1 m", 60, "rl:read");

// Contraseña de seguridad del panel de admin (cambios de rol). Por cuenta
// admin. Sin un freno propio, el modal de confirmacion seria un oraculo:
// quien ya tiene sesion de admin podria probar contraseñas hasta acertar y
// repartirse el rol a si mismo o a otra cuenta. Diez intentos en quince
// minutos deja margen a un dedo torpe y cierra la fuerza bruta.
export const adminSecurityRateLimit = makeLimiter("15 m", 10, "rl:admin-seguridad");

// Minimapa de la ficha (/api/products/[id]/location-map). Cada peticion que
// pasa el filtro es una consulta con service_role mas un snapshot firmado de
// Apple Maps, que se cobra por llamada. Tiene cubo propio a proposito y
// documentado aqui, como el token de MapKit: 20/min por IP cubre a alguien
// abriendo fichas a mano (una imagen por ficha y por tema, y el navegador la
// guarda un dia), y corta un rastreador que recorra el catalogo por ids.
export const productMapRateLimit = makeLimiter("1 m", 20, "rl:product-map");

// Reportes de contenido. Dos limitadores para dos abusos distintos.
//
// Por cuenta: un reporte de child_safety oculta el anuncio reportado al
// instante, asi que la cuenta que reporta muchas cosas seguidas puede barrer
// el catalogo. El trigger de la base ya corta el auto-ocultado al cuarto en
// 24h; esto corta las peticiones antes de llegar ahi. Diez a la hora es lo
// que el docstring de /api/reports llevaba prometiendo desde el principio sin
// que nadie lo aplicara.
//
// Por IP: la cuota por cuenta no sirve de nada contra quien se registra veinte
// veces. Mas holgada porque una IP puede ser un cafe entero.
export const reportRateLimit = makeLimiter("1 h", 10, "rl:report");
export const reportIpRateLimit = makeLimiter("1 h", 30, "rl:report-ip");

// Verificacion de documento. Cada invocacion es una llamada de vision de
// OpenAI, o sea que cada peticion cuesta dinero real de la cuenta del
// proyecto. Sin freno, un bucle autenticado vacia el saldo.
//
// Cinco a la hora es holgado para el caso legitimo: una persona verifica su
// identidad una vez, y si sale mal reintenta un par de veces con otra foto.
export const verificacionRateLimit = makeLimiter("1 h", 5, "rl:verificacion");

// Codigo de verificacion por correo. Tres limitadores porque son tres abusos
// distintos y una sola cuota no los cubre.
//
// Por correo al COMPROBAR: es la defensa contra adivinar el codigo. Va por
// correo y no por IP a proposito: el ataque de fuerza bruta se dirige a UNA
// cuenta, y una cuota por IP castigaria a la cafeteria entera mientras el
// atacante rota de IP y sigue. Diez en quince minutos deja margen para dedos
// gordos y sigue dejando el espacio de seis digitos fuera de alcance.
//
// Por IP al COMPROBAR: la cuota por correo no frena a quien prueba un codigo
// contra mil correos distintos. Mas holgada porque una IP puede ser un barrio.
//
// Por correo al REENVIAR: esto no protege a VICINO, protege la bandeja de
// entrada de un tercero. Sin freno, cualquiera escribe el correo de otra
// persona y le llena el buzon. Supabase ya impone 60 s entre envios al mismo
// correo (smtp_max_frequency); esto pone el techo de la hora.
export const otpVerifyRateLimit = makeLimiter("15 m", 10, "rl:otp-verify");
export const otpVerifyIpRateLimit = makeLimiter("15 m", 30, "rl:otp-verify-ip");
export const otpResendRateLimit = makeLimiter("1 h", 5, "rl:otp-resend");
export const otpResendIpRateLimit = makeLimiter("1 h", 15, "rl:otp-resend-ip");

// Emision de tokens de MapKit (/api/mapkit/token). Cada peticion firma un
// ES256 y devuelve una credencial de 30 minutos contra la cuenta de Apple
// Developer del proyecto: sin freno, un bucle gasta cuota de Apple que se
// paga y que no es nuestra de reponer.
//
// LOS NUMEROS SALEN DE LA CADENCIA MEDIDA, no de la intuicion. Un cliente
// legitimo gasta UNA peticion por CARGA DE DOCUMENTO que llegue a montar un
// mapa -- no una por pagina ni una por montaje: use-mapkit.ts sale antes de
// pedir si `window.mapkit` ya existe, memoiza la promesa de arranque para que
// varios mapas del mismo commit de React compartan una sola peticion, y reusa
// el primer token en el primer authorizationCallback. Sumar despues: una por
// cada refresco que pida Apple pasados los 30 minutos, y una por cada clic de
// "Reintentar cargar mapa". El peor caso honesto es alguien en /vender
// recargando mientras ajusta su direccion: del orden de 10-15 en cinco
// minutos.
//
// 60 cada 5 minutos, y no algo apretado tipo 5/min, PORQUE LA IP NO ES UNA
// PERSONA. Telcel e Izzi meten barrios enteros detras del mismo NAT: una
// cuota estrecha aqui no frena a un recolector, apaga el mapa a todo un
// vecindario. 60 deja sitio a varios dispositivos exigentes a la vez y aun
// asi corta a cualquiera que pase de 12/min sostenidos.
export const mapkitTokenRateLimit = makeLimiter("5 m", 60, "rl:mapkit");

// Mismo endpoint, cubo aparte y mas estrecho, para las peticiones que no
// traen NI Origin NI Referer.
//
// Ese caso existe de forma legitima -- un GET de mismo origen no lleva Origin,
// y el Referer lo puede recortar un navegador con privacidad estricta, una
// extension o un WebView de terceros -- asi que no se rechaza. Pero tampoco
// hay ningun navegador normal que caiga ahi de forma SOSTENIDA, y es la unica
// forma de pedir tokens desde fuera del sitio.
//
// Dicho claro porque se presta a confusion: Origin y Referer NO AUTENTICAN a
// nadie. Cualquiera las falsifica con una linea de curl. No son una puerta,
// son una etiqueta para elegir cubo: quien las falsifique cae en el cubo
// holgado, y ahi lo frena la cuota, no la lista de origenes.
export const mapkitTokenAnonRateLimit = makeLimiter("5 m", 15, "rl:mapkit-anon");

type EnforceResult = { ok: true } | { ok: false; error: string };

/**
 * Call as the first post-auth line of a sensitive server action.
 *   const { data: { user } } = await supabase.auth.getUser();
 *   if (!user) return { error: "..." };
 *   const rate = await enforce(writeRateLimit, `write:${user.id}`);
 *   if (!rate.ok) return { error: rate.error };
 *
 * Fails open on Upstash network errors — a transient blip should not lock
 * users out of the app. Genuine throttling returns ok: false.
 */
export async function enforce(
  limit: Ratelimit | null,
  identifier: string,
): Promise<EnforceResult> {
  if (!limit) {
    avisarSiNoHayFreno();
    return { ok: true };
  }
  try {
    const { success } = await limit.limit(identifier);
    if (!success) {
      return { ok: false, error: "Demasiadas solicitudes. Espera un momento e intenta de nuevo." };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[rate-limit] fail-open after error:", err);
    return { ok: true };
  }
}

/**
 * Middleware-friendly variant: returns success/fail without throwing.
 * Use from middleware.ts to short-circuit the request with 429.
 */
export async function check(
  limit: Ratelimit | null,
  identifier: string,
): Promise<{ success: boolean }> {
  if (!limit) {
    avisarSiNoHayFreno();
    return { success: true };
  }
  try {
    return await limit.limit(identifier);
  } catch (err) {
    console.warn("[rate-limit] fail-open after error:", err);
    return { success: true };
  }
}
