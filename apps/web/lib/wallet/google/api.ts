import "server-only";
import type { ConfigGoogle } from "../config";
import type { SnapshotMembresia } from "@/lib/lealtad/esquemas";
import { firmarJwtRs256 } from "./jwt";

/**
 * Google Wallet: una LoyaltyClass por programa y un LoyaltyObject por
 * membresia (PDF, seccion 5). El servidor crea/actualiza por la API REST con
 * la cuenta de servicio y entrega al cliente un enlace de guardado con un JWT
 * "skinny" (solo ids); el saldo se actualiza con PATCH desde la cola.
 *
 * Una cuenta emisora nueva nace en modo demo: los pases solo los ven cuentas
 * de prueba hasta pedir acceso de publicacion. Eso es tramite de Pedro.
 */
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const TIEMPO_MAXIMO_MS = 15_000;

export interface IdsGoogle {
  classId: string;
  objectId: string;
}

/** Ids validos para Google ([a-zA-Z0-9._-]); el issuerId es numerico. */
export function idsGoogle(config: ConfigGoogle, programId: string, membershipId: string): IdsGoogle {
  return {
    classId: `${config.issuerId}.vicino-p-${programId}`,
    objectId: `${config.issuerId}.vicino-m-${membershipId}`,
  };
}

export function cuerpoClaseGoogle(snapshot: SnapshotMembresia, ids: IdsGoogle, siteUrl: string) {
  const { program, negocio } = snapshot;
  return {
    id: ids.classId,
    issuerName: "VICINO",
    programName: `${negocio.nombre} · ${program.nombre}`,
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: program.color,
    programLogo: {
      sourceUri: { uri: `${siteUrl}/vicino-logo.png` },
      contentDescription: { defaultValue: { language: "es", value: "VICINO" } },
    },
    textModulesData: [
      { id: "premio", header: "Premio", body: program.premio },
      { id: "condiciones", header: "Condiciones", body: program.condiciones ?? "Sin condiciones adicionales." },
    ],
    homepageUri: { uri: siteUrl, description: "VICINO" },
  };
}

export function cuerpoObjetoGoogle(snapshot: SnapshotMembresia, ids: IdsGoogle) {
  const { membership, program, cliente } = snapshot;
  return {
    id: ids.objectId,
    classId: ids.classId,
    state: membership.status === "activa" ? "ACTIVE" : "INACTIVE",
    accountId: membership.public_id,
    accountName: cliente.nombre,
    loyaltyPoints: { label: "Sellos", balance: { int: membership.sellos_disponibles } },
    secondaryLoyaltyPoints: { label: "Meta", balance: { int: program.meta_sellos } },
    barcode: { type: "QR_CODE", value: membership.public_id, alternateText: membership.public_id },
    textModulesData: [
      { id: "premio", header: "Premio", body: program.premio },
      { id: "progreso", header: "Progreso", body: `${membership.sellos_disponibles} de ${program.meta_sellos} sellos` },
    ],
  };
}

/** Enlace "Add to Google Wallet": JWT skinny firmado por la cuenta de servicio. */
export function enlaceGuardarGoogle(config: ConfigGoogle, objectId: string, siteUrl: string, ahora = Date.now()): string {
  const jwt = firmarJwtRs256(
    {
      iss: config.serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(ahora / 1000),
      origins: [siteUrl],
      payload: { loyaltyObjects: [{ id: objectId }] },
    },
    config.privateKey,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

let tokenEnMemoria: { valor: string; expira: number } | null = null;

async function tokenDeAcceso(config: ConfigGoogle): Promise<string> {
  const ahora = Date.now();
  if (tokenEnMemoria && tokenEnMemoria.expira > ahora + 60_000) return tokenEnMemoria.valor;
  const iat = Math.floor(ahora / 1000);
  const assertion = firmarJwtRs256(
    { iss: config.serviceAccountEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 },
    config.privateKey,
  );
  const respuesta = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  if (!respuesta.ok) throw new Error(`Google OAuth: HTTP ${respuesta.status}`);
  const datos = (await respuesta.json()) as { access_token?: string; expires_in?: number };
  if (!datos.access_token) throw new Error("Google OAuth: respuesta sin access_token");
  tokenEnMemoria = { valor: datos.access_token, expira: ahora + (datos.expires_in ?? 3600) * 1000 };
  return datos.access_token;
}

async function llamar(config: ConfigGoogle, metodo: "GET" | "POST" | "PATCH", ruta: string, cuerpo?: unknown): Promise<{ status: number; datos: unknown }> {
  const token = await tokenDeAcceso(config);
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  const texto = await respuesta.text();
  let datos: unknown = texto;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* texto plano */ }
  return { status: respuesta.status, datos };
}

function exigir(resultado: { status: number; datos: unknown }, accion: string): void {
  if (resultado.status >= 200 && resultado.status < 300) return;
  const detalle = typeof resultado.datos === "string" ? resultado.datos.slice(0, 200) : JSON.stringify(resultado.datos).slice(0, 200);
  throw new Error(`Google Wallet ${accion}: HTTP ${resultado.status} ${detalle}`);
}

/** Crea la clase si no existe; si existe, la actualiza con las reglas vigentes. */
export async function asegurarClaseGoogle(config: ConfigGoogle, snapshot: SnapshotMembresia, ids: IdsGoogle, siteUrl: string): Promise<void> {
  const cuerpo = cuerpoClaseGoogle(snapshot, ids, siteUrl);
  const existente = await llamar(config, "GET", `/loyaltyClass/${encodeURIComponent(ids.classId)}`);
  if (existente.status === 404) {
    const creada = await llamar(config, "POST", "/loyaltyClass", cuerpo);
    // 409: otra peticion la creo un instante antes; vale igual.
    if (creada.status !== 409) {
      exigir(creada, "crear clase");
      return;
    }
  }
  if (existente.status !== 404) exigir(existente, "leer clase");
  const { id: _id, reviewStatus: _reviewStatus, ...cambios } = cuerpo;
  void _id;
  void _reviewStatus;
  exigir(await llamar(config, "PATCH", `/loyaltyClass/${encodeURIComponent(ids.classId)}`, cambios), "actualizar clase");
}

/** Crea el objeto de la membresia si no existe; si existe, sincroniza saldo y estado. */
export async function asegurarObjetoGoogle(config: ConfigGoogle, snapshot: SnapshotMembresia, ids: IdsGoogle): Promise<void> {
  const cuerpo = cuerpoObjetoGoogle(snapshot, ids);
  const existente = await llamar(config, "GET", `/loyaltyObject/${encodeURIComponent(ids.objectId)}`);
  if (existente.status === 404) {
    const creado = await llamar(config, "POST", "/loyaltyObject", cuerpo);
    if (creado.status !== 409) {
      exigir(creado, "crear objeto");
      return;
    }
  }
  if (existente.status !== 404) exigir(existente, "leer objeto");
  await actualizarObjetoGoogle(config, snapshot, ids);
}

/** PATCH del saldo y del estado (lo llama la cola en cada cambio). */
export async function actualizarObjetoGoogle(config: ConfigGoogle, snapshot: SnapshotMembresia, ids: IdsGoogle): Promise<void> {
  const { id: _id, classId: _classId, ...cambios } = cuerpoObjetoGoogle(snapshot, ids);
  void _id;
  void _classId;
  exigir(await llamar(config, "PATCH", `/loyaltyObject/${encodeURIComponent(ids.objectId)}`, cambios), "actualizar objeto");
}
