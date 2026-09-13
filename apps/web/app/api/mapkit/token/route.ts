import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 1. Validar credenciales de Apple Developer requeridas
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

  const CANONICAL_ORIGINS = [
    "https://vicinomarket.com",
    "https://www.vicinomarket.com",
    "https://startup-marketplace-web.vercel.app",
  ];

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
  if (clientOrigin && !isOriginAllowed(clientOrigin)) {
    return NextResponse.json(
      { error: "Origen no autorizado" },
      { status: 403 }
    );
  }

  // Origen a sellar en el JWT: el origen validado o el canónico de producción / local de desarrollo
  const targetOrigin = clientOrigin || (isDev ? "http://localhost:3000" : "https://vicinomarket.com");

  // 3. Firmar JWT con claim origin y exp de 30 minutos
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

    const now = Math.floor(Date.now() / 1000);
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
    return NextResponse.json({ token });
  } catch (err) {
    console.error("[mapkit-token] Error al firmar JWT de MapKit:", err);
    return NextResponse.json(
      { error: "Error al generar token de MapKit" },
      { status: 500 }
    );
  }
}
