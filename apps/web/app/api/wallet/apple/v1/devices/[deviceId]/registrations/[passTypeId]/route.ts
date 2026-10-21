import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { conLealtad } from "@/types/loyalty.types";
import { configWallet } from "@/lib/wallet/config";
import { cuotaWebService, ID_DISPOSITIVO_VALIDO, respuestaVacia } from "@/lib/wallet/apple/web-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Protocolo de Apple: lista de seriales que cambiaron desde la ultima vez
 * (?passesUpdatedSince=<tag>). Apple NO manda Authorization aqui; solo se
 * contesta con los pases que ese mismo dispositivo registro, y solo con
 * seriales (ningun dato de la persona). El tag es GLOBAL (epoch en ms del
 * ultimo cambio del pase): la version de la outbox es por membresia y con dos
 * pases en el mismo telefono dejaria a uno sin avisar.
 */
export async function GET(request: Request, { params }: { params: Promise<{ deviceId: string; passTypeId: string }> }) {
  const { deviceId, passTypeId } = await params;
  const config = configWallet();
  if (!config.apple) return respuestaVacia(503);
  if (passTypeId !== config.apple.passTypeId) return respuestaVacia(404);
  if (!ID_DISPOSITIVO_VALIDO.test(deviceId)) return respuestaVacia(400);
  const limitado = await cuotaWebService(request);
  if (limitado) return limitado;

  const bruto = new URL(request.url).searchParams.get("passesUpdatedSince") ?? "0";
  if (!/^[0-9]{1,15}$/.test(bruto)) return respuestaVacia(400);
  const corte = new Date(Number(bruto)).toISOString();

  try {
    const admin = conLealtad(createAdminClient());
    const { data: registros, error } = await admin
      .from("apple_device_registrations")
      .select("pass_id")
      .eq("device_library_identifier", deviceId);
    if (error) throw error;
    if (!registros || registros.length === 0) return respuestaVacia(204);

    const { data: pases, error: errorPases } = await admin
      .from("wallet_passes")
      .select("serial_number, updated_at")
      .eq("proveedor", "apple")
      .in("id", registros.map((r) => r.pass_id))
      .gt("updated_at", corte);
    if (errorPases) throw errorPases;
    if (!pases || pases.length === 0) return respuestaVacia(204);

    const ultima = Math.max(...pases.map((p) => Date.parse(p.updated_at)));
    return NextResponse.json(
      { lastUpdated: String(ultima), serialNumbers: pases.map((p) => p.serial_number) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "apple_wallet_list" } });
    return respuestaVacia(500);
  }
}
