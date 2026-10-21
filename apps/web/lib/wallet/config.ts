import "server-only";

/**
 * Credenciales de Wallet, SOLO desde el entorno (Vercel), nunca del repo.
 *
 * Sin credenciales la funcion no falla: `apple` o `google` quedan en null y
 * la interfaz esconde el boton de esa cartera y muestra la tarjeta interna.
 * Emitir o sincronizar con un proveedor apagado devuelve 503, no un 500.
 *
 * Variables (ver apps/web/.env.example):
 *   APPLE_WALLET_PASS_TYPE_ID        pass.com.vicinomarket.lealtad
 *   APPLE_WALLET_TEAM_ID             Team ID de Apple Developer
 *   APPLE_WALLET_SIGNER_CERT         certificado del Pass Type ID (PEM o PEM en base64)
 *   APPLE_WALLET_SIGNER_KEY          su clave privada (PEM o PEM en base64)
 *   APPLE_WALLET_SIGNER_KEY_PASSPHRASE  opcional
 *   APPLE_WALLET_WWDR_CERT           Apple WWDR G4 (PEM o PEM en base64)
 *   GOOGLE_WALLET_ISSUER_ID          numero de emisor de Pay & Wallet Console
 *   GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_WALLET_PRIVATE_KEY        clave privada PEM de la cuenta de servicio
 */
export interface ConfigApple {
  passTypeId: string;
  teamId: string;
  signerCert: string;
  signerKey: string;
  signerKeyPassphrase?: string;
  wwdr: string;
}

export interface ConfigGoogle {
  issuerId: string;
  serviceAccountEmail: string;
  privateKey: string;
}

export interface ConfigWallet {
  apple: ConfigApple | null;
  google: ConfigGoogle | null;
  siteUrl: string;
}

const SITIO_POR_DEFECTO = "https://vicinomarket.com";

/**
 * Acepta el PEM tal cual (con saltos reales o con "\n" literales, que es como
 * Vercel suele guardarlos) o el PEM completo en base64 (mas comodo de pegar).
 */
export function normalizarPem(valor: string | undefined): string | undefined {
  const bruto = valor?.trim();
  if (!bruto) return undefined;
  if (bruto.includes("-----BEGIN")) return bruto.replace(/\\n/g, "\n");
  try {
    const decodificado = Buffer.from(bruto, "base64").toString("utf8");
    if (decodificado.includes("-----BEGIN")) return decodificado;
  } catch {
    // no era base64
  }
  return undefined;
}

/** `env` se inyecta en las pruebas; en la app es process.env. */
export function configWallet(env: Record<string, string | undefined> = process.env): ConfigWallet {
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? SITIO_POR_DEFECTO).replace(/\/$/, "");

  const passTypeId = env.APPLE_WALLET_PASS_TYPE_ID?.trim();
  const teamId = env.APPLE_WALLET_TEAM_ID?.trim();
  const signerCert = normalizarPem(env.APPLE_WALLET_SIGNER_CERT);
  const signerKey = normalizarPem(env.APPLE_WALLET_SIGNER_KEY);
  const wwdr = normalizarPem(env.APPLE_WALLET_WWDR_CERT);
  const apple: ConfigApple | null =
    passTypeId && teamId && signerCert && signerKey && wwdr
      ? {
          passTypeId,
          teamId,
          signerCert,
          signerKey,
          signerKeyPassphrase: env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE || undefined,
          wwdr,
        }
      : null;

  const issuerId = env.GOOGLE_WALLET_ISSUER_ID?.trim();
  const serviceAccountEmail = env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = normalizarPem(env.GOOGLE_WALLET_PRIVATE_KEY);
  const google: ConfigGoogle | null =
    issuerId && /^[0-9]+$/.test(issuerId) && serviceAccountEmail && privateKey
      ? { issuerId, serviceAccountEmail, privateKey }
      : null;

  return { apple, google, siteUrl };
}

/** Lo unico que la interfaz necesita saber: que botones mostrar. */
export function disponibilidadWallet(): { apple: boolean; google: boolean } {
  const config = configWallet();
  return { apple: config.apple !== null, google: config.google !== null };
}
