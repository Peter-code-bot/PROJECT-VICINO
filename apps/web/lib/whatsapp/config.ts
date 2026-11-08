// Configuracion de WhatsApp Cloud API que vive SOLO en el servidor (Vercel).
// Importarlo desde un componente de cliente es un error de compilacion, no un
// token filtrado al navegador.
import "server-only";

/**
 * Version de Graph API por defecto. v27.0 salio el 4-nov-2026 y Meta
 * garantiza al menos dos anos por version; se puede fijar otra con
 * WHATSAPP_GRAPH_VERSION sin tocar codigo. Siempre se manda explicita: una
 * llamada sin version usa la que tenga puesta el App Dashboard, que nadie
 * vigila.
 */
export const VERSION_GRAPH_POR_DEFECTO = "v27.0";
export const GRAPH_BASE_URL = "https://graph.facebook.com";

const RE_VERSION = /^v\d{1,3}\.\d{1,2}$/;

export interface ConfiguracionWhatsApp {
  /** Token de acceso (System User) con whatsapp_business_messaging. */
  token: string;
  version: string;
  baseUrl: string;
}

type Entorno = Record<string, string | undefined>;

/**
 * Lo que hace falta para ENVIAR por la API de Meta. `null` cuando falta el
 * token: la bandeja sigue recibiendo y mostrando mensajes, pero responder da
 * un error claro en vez de un 500.
 */
export function configuracionWhatsApp(env: Entorno = process.env): ConfiguracionWhatsApp | null {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const pedida = env.WHATSAPP_GRAPH_VERSION?.trim();
  const version = pedida && RE_VERSION.test(pedida) ? pedida : VERSION_GRAPH_POR_DEFECTO;
  return { token, version, baseUrl: GRAPH_BASE_URL };
}

/**
 * Cadena que Meta nos devuelve en el GET de verificacion del webhook
 * (hub.verify_token). La elige quien configura; sin ella el GET responde 503.
 */
export function tokenVerificacionWebhook(env: Entorno = process.env): string | null {
  const valor = env.WHATSAPP_VERIFY_TOKEN?.trim();
  return valor && valor.length >= 16 ? valor : null;
}

/**
 * App Secret de la app de Meta, OPCIONAL en Vercel. La firma la verifica
 * siempre Postgres con el secreto del Vault; si ademas esta aqui, la ruta
 * rechaza antes las peticiones con firma invalida y se ahorra la llamada.
 */
export function secretoAppWhatsApp(env: Entorno = process.env): string | null {
  const valor = env.WHATSAPP_APP_SECRET?.trim();
  return valor && valor.length >= 16 ? valor : null;
}
