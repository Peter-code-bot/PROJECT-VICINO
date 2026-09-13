import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  // 1. Si ya se configuró un token estático generado desde Apple Developer
  const staticToken =
    process.env.NEXT_PUBLIC_MAPKIT_TOKEN ||
    process.env.APPLE_MAPKIT_TOKEN;

  if (staticToken) {
    return NextResponse.json({ token: staticToken });
  }

  // 2. Si se proporcionaron credenciales para firmado dinámico
  const teamId = process.env.APPLE_MAPKIT_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const rawKey = process.env.APPLE_MAPKIT_PRIVATE_KEY;

  if (teamId && keyId && rawKey) {
    try {
      // Normalizar clave privada .p8 (soporta saltos de línea reales o \n escapados)
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
        exp: now + 3600 * 2, // 2 horas
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
        { error: "Error al generar token de MapKit", details: String(err) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      configured: false,
      message: "MapKit no configurado aún (requiere NEXT_PUBLIC_MAPKIT_TOKEN o credenciales de Apple Developer)",
    },
    { status: 200 }
  );
}
