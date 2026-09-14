import { NextResponse } from "next/server";
import crypto from "node:crypto";

import {
  check,
  getClientIp,
  mapkitTokenAnonRateLimit,
  mapkitTokenRateLimit,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const CANONICAL_ORIGINS = [
  "https://vicinomarket.com",
  "https://www.vicinomarket.com",
  "https://startup-marketplace-web.vercel.app",
];

// ---------------------------------------------------------------------------
// Tope local, por isolate. La red de seguridad, no el limite de verdad.
//
// Los dos limitadores de lib/rate-limit.ts viven en Upstash, y Upstash hoy no
// esta provisionado en Vercel Production: sin esas dos variables makeLimiter
// devuelve null y check() responde success en todos los casos. O sea que un
// limite que SOLO se apoyara en Redis seria, hoy mismo, exactamente lo que ya
// hay: nada. Esto sirve para que la ruta no siga indefensa mientras llegan las
// credenciales.
//
// LO QUE ESTO NO ES: un limite global. El estado vive en la memoria de UN
// isolate, y Vercel arranca isolates por region y por arranque en frio, asi
// que quien reparta su trafico se salta esto sin esfuerzo. Lo que si impide es
// que una sola conexion sostenida contra un solo isolate dispare miles de
// firmas ES256. El limite real llega con Redis.
//
// El molde (contador en memoria + poda) es el que ya usa
// app/api/admin/report-webhook/route.ts; no se inventa nada nuevo.
const TOPE_LOCAL = 30;
const VENTANA_LOCAL_MS = 60_000;
const MAX_CLAVES = 5_000;
const conteoLocal = new Map<string, { n: number; resetAt: number }>();

function excedeTopeLocal(ip: string, ahora: number): boolean {
  // Poda por tamano: sin esto el Map crece sin fin en un isolate longevo y se
  // convierte en una fuga de memoria.
  if (conteoLocal.size > MAX_CLAVES) {
    for (const [k, v] of conteoLocal) {
      if (v.resetAt <= ahora) conteoLocal.delete(k);
    }
    if (conteoLocal.size > MAX_CLAVES) conteoLocal.clear();
  }

  const actual = conteoLocal.get(ip);
  if (!actual || actual.resetAt <= ahora) {
    conteoLocal.set(ip, { n: 1, resetAt: ahora + VENTANA_LOCAL_MS });
    return false;
  }
  actual.n += 1;
  return actual.n > TOPE_LOCAL;
}

// ---------------------------------------------------------------------------
// Registro AGREGADO. Cero eventos de Sentry por peticion bloqueada.
//
// Este proyecto ya se quemo con esto: un aviso apoyado en una variable de
// modulo salio 77 veces en una semana -- el 62% del volumen de errores del
// proyecto -- porque en Vercel "una vez por modulo" significa "una vez por
// arranque en frio, por runtime y por region". Un captureMessage por bloqueo,
// en una ruta que puede recibir una rafaga, es peor todavia: el escenario que
// este freno existe para cortar es justo el que inundaria Sentry.
//
// Asi que se cuenta en memoria y se emite UNA linea de JSON estructurado por
// ventana, que es lo que Vercel Logs agrega bien.
const VENTANA_LOG_MS = 5 * 60_000;
const contadores = {
  emitidos: 0,
  bloqueados_verificado: 0,
  bloqueados_sin_cabeceras: 0,
  bloqueados_tope_local: 0,
  rechazados_403: 0,
  desde_app_movil: 0,
};
let ventanaLogAbiertaEn = 0;

function contar(clave: keyof typeof contadores, ahora: number): void {
  contadores[clave] += 1;
  if (ventanaLogAbiertaEn === 0) {
    ventanaLogAbiertaEn = ahora;
    return;
  }
  if (ahora - ventanaLogAbiertaEn < VENTANA_LOG_MS) return;

  const total = Object.values(contadores).reduce((a, b) => a + b, 0);
  if (total > 0) {
    console.warn(
      "[mapkit-token] " +
        JSON.stringify({
          ventana_min: Math.round((ahora - ventanaLogAbiertaEn) / 60_000),
          ...contadores,
        }),
    );
  }
  for (const k of Object.keys(contadores) as Array<keyof typeof contadores>) {
    contadores[k] = 0;
  }
  ventanaLogAbiertaEn = ahora;
}

export async function GET(req: Request) {
  // 1. Validar credenciales de Apple Developer requeridas.
  //    Va ANTES de la cuota a proposito: un 503 por configuracion ausente no
  //    tiene por que gastarle el cupo a nadie.
  const teamId = process.env.APPLE_MAPKIT_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const rawKey = process.env.APPLE_MAPKIT_PRIVATE_KEY;

  if (!teamId || !keyId || !rawKey) {
    return NextResponse.json(
      { error: "Servicio de mapas no configurado" },
      { status: 503 }
    );
  }

  // 2. Extraer y validar el origen del cliente
  const originHeader = req.headers.get("origin");
  const refererHeader = req.headers.get("referer");

  let clientOrigin: string | null = null;
  if (originHeader) {
    try {
      clientOrigin = new URL(originHeader).origin;
    } catch {
      clientOrigin = null;
    }
  }
  if (!clientOrigin && refererHeader) {
    try {
      clientOrigin = new URL(refererHeader).origin;
    } catch {
      clientOrigin = null;
    }
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const isDev = process.env.NODE_ENV === "development" || vercelEnv === "development";

  function isOriginAllowed(origin: string): boolean {
    if (CANONICAL_ORIGINS.includes(origin)) return true;

    // Previews en Vercel (ramas como feat/* o design)
    if (vercelEnv === "preview") {
      try {
        const u = new URL(origin);
        if (u.protocol === "https:" && u.hostname.endsWith(".vercel.app")) {
          return true;
        }
      } catch {
        return false;
      }
    }

    // Desarrollo local únicamente
    if (isDev) {
      if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") {
        return true;
      }
    }

    return false;
  }

  // Si se envió cabecera de origen o referer, DEBE pertenecer a la lista autorizada
  const ahora = Date.now();
  if (clientOrigin && !isOriginAllowed(clientOrigin)) {
    contar("rechazados_403", ahora);
    return NextResponse.json(
      { error: "Origen no autorizado" },
      { status: 403 }
    );
  }

  // 3. Cuota, en dos niveles segun lo que se pudo clasificar.
  //
  //    NO se rechaza la peticion sin cabeceras. Un GET de mismo origen no
  //    lleva Origin por definicion del navegador, y el Referer lo puede
  //    recortar una politica de privacidad, una extension o un WebView de
  //    terceros: rechazarlas en bloque apagaria el mapa a gente real. Lo que
  //    se hace es meterlas en un cubo propio y mas estrecho, porque ningun
  //    navegador normal cae ahi de forma sostenida y es la unica via para
  //    pedir tokens desde fuera del sitio.
  //
  //    Y conviene no enganarse con la clasificacion: Origin y Referer no
  //    autentican a nadie, se falsifican con una linea de curl. Quien las
  //    imite cae en el cubo holgado -- y ahi lo para la cuota, que es lo que
  //    de verdad limita, no la lista de origenes.
  const ip = getClientIp(req.headers);
  const verificado = clientOrigin !== null;

  if (excedeTopeLocal(ip, ahora)) {
    contar("bloqueados_tope_local", ahora);
    return tooMany();
  }

  const cuota = verificado
    ? await check(mapkitTokenRateLimit, `mapkit:${ip}`)
    : await check(mapkitTokenAnonRateLimit, `mapkit-anon:${ip}`);
  if (!cuota.success) {
    contar(verificado ? "bloqueados_verificado" : "bloqueados_sin_cabeceras", ahora);
    return tooMany();
  }

  // Senal util para leer los logs, NO para autorizar: capacitor.config.ts
  // añade estos sufijos al User-Agent de la app. Sirve para saber si el
  // trafico sin cabeceras viene de la app o no; tambien se falsifica.
  const ua = req.headers.get("user-agent") ?? "";
  if (ua.includes("VICINO-Android") || ua.includes("VICINO-iOS")) {
    contadores.desde_app_movil += 1;
  }

  // 4. Origen a sellar en el JWT.
  //
  //    Cuando no hay Origin ni Referer esto caia a la constante de produccion.
  //    Y el host de Vercel sigue vivo sirviendo la app entera (no es un 308):
  //    una peticion sin cabeceras desde startup-marketplace-web.vercel.app se
  //    llevaba un token sellado para vicinomarket.com, que Apple rechaza. Mapa
  //    roto en ese dominio, y sin error en ningun log nuestro.
  //
  //    Ahora el respaldo sale del Host de la propia peticion y pasa por el
  //    MISMO isOriginAllowed, asi que el token sigue restringido a un origen
  //    autorizado y deja de romper el dominio de la Data Safety URL.
  let targetOrigin = clientOrigin;
  if (!targetOrigin) {
    try {
      const propio = new URL(req.url).origin;
      if (isOriginAllowed(propio)) targetOrigin = propio;
    } catch {
      targetOrigin = null;
    }
  }
  if (!targetOrigin) {
    targetOrigin = isDev ? "http://localhost:3000" : "https://vicinomarket.com";
  }

  // 5. Firmar JWT con claim origin y exp de 30 minutos
  try {
    let privateKey = rawKey.trim().replace(/\\n/g, "\n");
    if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

    const header = {
      alg: "ES256",
      typ: "JWT",
      kid: keyId,
    };

    const now = Math.floor(ahora / 1000);
    const payload = {
      iss: teamId,
      iat: now,
      exp: now + 1800, // 30 minutos (Apple recomienda <= 30 min)
      origin: targetOrigin,
    };

    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64(header)}.${b64(payload)}`;

    const signature = crypto.sign("SHA256", Buffer.from(unsigned), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");

    const token = `${unsigned}.${signature}`;
    contar("emitidos", ahora);
    // El token es una credencial con nombre y con caducidad: no debe quedarse
    // en ninguna cache intermedia.
    return NextResponse.json(
      { token },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[mapkit-token] Error al firmar JWT de MapKit:", err);
    return NextResponse.json(
      { error: "Error al generar token de MapKit" },
      { status: 500 }
    );
  }
}

/**
 * 429 con Retry-After. El cliente ya degrada bien: fetchTokenFresh devuelve
 * null si la respuesta no es ok, y apple-map-container pinta su respaldo con
 * boton de reintentar. Nunca deja el mapa colgado esperando.
 */
function tooMany(): NextResponse {
  return NextResponse.json(
    { error: "Demasiadas solicitudes de mapa. Inténtalo en un minuto." },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "private, no-store" },
    },
  );
}
