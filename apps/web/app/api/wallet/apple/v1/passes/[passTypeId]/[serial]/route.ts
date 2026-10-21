import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { conLealtad } from "@/types/loyalty.types";
import { configWallet } from "@/lib/wallet/config";
import { construirPaseApple } from "@/lib/wallet/apple/pase";
import { autenticarPase, cuotaWebService, respuestaVacia } from "@/lib/wallet/apple/web-service";
import { snapshotDeMembresia } from "@/lib/wallet/sincronizar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Protocolo de Apple: el telefono descarga la version mas reciente del pase
 * tras un aviso de APNs (o al reabrir Wallet). Autenticado con el token del
 * pase. Si no hay nada nuevo desde If-Modified-Since, 304.
 */
export async function GET(request: Request, { params }: { params: Promise<{ passTypeId: string; serial: string }> }) {
  const { passTypeId, serial } = await params;
  const config = configWallet();
  if (!config.apple) return respuestaVacia(503);
  const limitado = await cuotaWebService(request);
  if (limitado) return limitado;
  try {
    const admin = conLealtad(createAdminClient());
    const auth = await autenticarPase(admin, config.apple, request, passTypeId, serial);
    if (!auth.ok) return respuestaVacia(auth.status);
    const pase = auth.pass;
    if (!pase.authentication_token) return respuestaVacia(500);

    const modificado = new Date(pase.updated_at);
    const desde = Date.parse(request.headers.get("if-modified-since") ?? "");
    const alDia = pase.version_sincronizada >= pase.version_deseada;
    if (alDia && !Number.isNaN(desde) && desde >= Math.floor(modificado.getTime() / 1000) * 1000) {
      return respuestaVacia(304);
    }

    const snapshot = await snapshotDeMembresia(admin, pase.membership_id);
    const archivo = construirPaseApple({
      config: config.apple,
      snapshot,
      serialNumber: pase.serial_number,
      authenticationToken: pase.authentication_token,
      siteUrl: config.siteUrl,
    });
    if (!alDia) {
      await admin.from("wallet_passes").update({ version_sincronizada: pase.version_deseada }).eq("id", pase.id);
    }
    return new Response(new Uint8Array(archivo), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Last-Modified": modificado.toUTCString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "apple_wallet_get_pass" } });
    return respuestaVacia(500);
  }
}
