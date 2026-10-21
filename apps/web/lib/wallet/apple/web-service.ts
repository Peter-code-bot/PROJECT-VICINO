import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { ClienteLealtad, WalletPassRow } from "@/types/loyalty.types";
import type { ConfigApple } from "../config";
import { enforce, getClientIp, walletWebServiceRateLimit } from "@/lib/rate-limit";

/**
 * Comun a las rutas del web service de Apple (/api/wallet/apple/v1/...).
 *
 * Apple manda `Authorization: ApplePass <authenticationToken>` en registrar,
 * dar de baja y descargar; NO lo manda al listar seriales de un dispositivo.
 * El token se compara en tiempo constante y el serial se busca con el
 * proveedor fijo: un serial de Google nunca autentica un pase de Apple.
 */
export const SERIAL_VALIDO = /^vicino-[0-9a-f-]{36}$/;
export const ID_DISPOSITIVO_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

export function tokenDeCabecera(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const [esquema, token, ...resto] = auth.split(" ");
  if (esquema !== "ApplePass" || !token || resto.length > 0) return null;
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export function tokensIguales(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export type PaseAutenticado = { ok: true; pass: WalletPassRow } | { ok: false; status: 401 | 404 | 429 };

export async function autenticarPase(
  admin: ClienteLealtad,
  config: ConfigApple,
  request: Request,
  passTypeId: string,
  serial: string,
): Promise<PaseAutenticado> {
  if (passTypeId !== config.passTypeId || !SERIAL_VALIDO.test(serial)) return { ok: false, status: 404 };
  const token = tokenDeCabecera(request);
  if (!token) return { ok: false, status: 401 };
  const { data, error } = await admin
    .from("wallet_passes")
    .select("*")
    .eq("proveedor", "apple")
    .eq("serial_number", serial)
    .maybeSingle();
  if (error) throw error;
  // Serial desconocido y token equivocado responden igual: un 404 aqui diria
  // que serial existe sin tener su token.
  if (!data || !tokensIguales(token, data.authentication_token)) return { ok: false, status: 401 };
  return { ok: true, pass: data };
}

export function respuestaVacia(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** Cuota por IP del web service; sin Upstash es un no-op como el resto del repo. */
export async function cuotaWebService(request: Request): Promise<Response | null> {
  const cuota = await enforce(walletWebServiceRateLimit, `apple:${getClientIp(request.headers)}`);
  return cuota.ok ? null : respuestaVacia(429);
}
