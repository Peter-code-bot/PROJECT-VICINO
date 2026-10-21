import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { conLealtad } from "@/types/loyalty.types";
import { configWallet } from "@/lib/wallet/config";
import { autenticarPase, cuotaWebService, ID_DISPOSITIVO_VALIDO, respuestaVacia } from "@/lib/wallet/apple/web-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ deviceId: string; passTypeId: string; serial: string }> };
const PUSH_TOKEN_VALIDO = /^[0-9a-fA-F]{32,200}$/;

/**
 * Protocolo de Apple: registrar un dispositivo para recibir avisos de un pase
 * (POST, cuerpo {pushToken}) y darlo de baja (DELETE). Autenticado con el
 * authenticationToken del pase. El primer registro es la unica prueba de que
 * el pase se GUARDO: ahi se fija wallet_passes.guardado_at. Un trigger deja
 * como mucho 5 dispositivos por pase.
 */
export async function POST(request: Request, { params }: Params) {
  const { deviceId, passTypeId, serial } = await params;
  const config = configWallet();
  if (!config.apple) return respuestaVacia(503);
  if (!ID_DISPOSITIVO_VALIDO.test(deviceId)) return respuestaVacia(400);
  const limitado = await cuotaWebService(request);
  if (limitado) return limitado;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return respuestaVacia(400);
  }
  const pushToken =
    cuerpo && typeof cuerpo === "object" && "pushToken" in cuerpo && typeof cuerpo.pushToken === "string"
      ? cuerpo.pushToken
      : null;
  if (!pushToken || !PUSH_TOKEN_VALIDO.test(pushToken)) return respuestaVacia(400);

  try {
    const admin = conLealtad(createAdminClient());
    const auth = await autenticarPase(admin, config.apple, request, passTypeId, serial);
    if (!auth.ok) return respuestaVacia(auth.status);

    const { data: existente, error } = await admin
      .from("apple_device_registrations")
      .select("push_token")
      .eq("device_library_identifier", deviceId)
      .eq("pass_id", auth.pass.id)
      .maybeSingle();
    if (error) throw error;

    if (existente) {
      if (existente.push_token !== pushToken) {
        const { error: errorCambio } = await admin
          .from("apple_device_registrations")
          .update({ push_token: pushToken })
          .eq("device_library_identifier", deviceId)
          .eq("pass_id", auth.pass.id);
        if (errorCambio) throw errorCambio;
      }
      return respuestaVacia(200);
    }

    const { error: errorAlta } = await admin
      .from("apple_device_registrations")
      .insert({ device_library_identifier: deviceId, pass_id: auth.pass.id, push_token: pushToken });
    if (errorAlta) throw errorAlta;
    if (!auth.pass.guardado_at) {
      await admin.from("wallet_passes").update({ guardado_at: new Date().toISOString() }).eq("id", auth.pass.id);
    }
    return respuestaVacia(201);
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "apple_wallet_register" } });
    return respuestaVacia(500);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { deviceId, passTypeId, serial } = await params;
  const config = configWallet();
  if (!config.apple) return respuestaVacia(503);
  if (!ID_DISPOSITIVO_VALIDO.test(deviceId)) return respuestaVacia(400);
  const limitado = await cuotaWebService(request);
  if (limitado) return limitado;
  try {
    const admin = conLealtad(createAdminClient());
    const auth = await autenticarPase(admin, config.apple, request, passTypeId, serial);
    if (!auth.ok) return respuestaVacia(auth.status);
    const { error } = await admin
      .from("apple_device_registrations")
      .delete()
      .eq("device_library_identifier", deviceId)
      .eq("pass_id", auth.pass.id);
    if (error) throw error;
    return respuestaVacia(200);
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "apple_wallet_unregister" } });
    return respuestaVacia(500);
  }
}
