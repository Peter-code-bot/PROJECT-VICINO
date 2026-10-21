import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { enforce, walletEmitRateLimit } from "@/lib/rate-limit";
import { conLealtad } from "@/types/loyalty.types";
import { pasePreparadoSchema } from "@/lib/lealtad/esquemas";
import { configWallet } from "@/lib/wallet/config";
import { construirPaseApple } from "@/lib/wallet/apple/pase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Descarga del .pkpass por su titular ("Añadir a Apple Wallet").
 *
 * La identidad sale de la sesion y la RPC wallet_pase_preparar solo contesta
 * al dueño de la membresia; el archivo se firma aqui con el certificado del
 * servidor. Generarlo no prueba que se guardo: eso lo dice el registro del
 * dispositivo en /api/wallet/apple/v1/devices/...
 */
export async function GET(_request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  const cabeceras = { "Cache-Control": "private, no-store" };
  if (!UUID.test(membershipId)) return NextResponse.json({ ok: false }, { status: 404, headers: cabeceras });

  const config = configWallet();
  if (!config.apple) {
    return NextResponse.json({ ok: false, error: "apple_wallet_no_configurado" }, { status: 503, headers: cabeceras });
  }

  const supabase = await createClient();
  let usuario;
  try {
    usuario = await usuarioOInvitado(supabase);
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: cabeceras });
  }
  if (!usuario) return NextResponse.json({ ok: false }, { status: 401, headers: cabeceras });

  const cuota = await enforce(walletEmitRateLimit, `wallet:${usuario.id}`);
  if (!cuota.ok) return NextResponse.json({ ok: false, error: cuota.error }, { status: 429, headers: cabeceras });

  const { data, error } = await conLealtad(supabase).rpc("wallet_pase_preparar", {
    p_membership_id: membershipId,
    p_proveedor: "apple",
  });
  if (error) {
    Sentry.captureException(error, {
      tags: { action: "wallet_pase_apple" },
      contexts: { supabase: { code: error.code, details: error.details, hint: error.hint } },
    });
    const status = error.code === "PT404" ? 404 : error.code === "42501" ? 401 : 400;
    return NextResponse.json({ ok: false }, { status, headers: cabeceras });
  }

  const preparado = pasePreparadoSchema.safeParse(data);
  if (!preparado.success || !preparado.data.pass.authentication_token) {
    Sentry.captureMessage("wallet_pase_preparar devolvio una forma inesperada", { level: "error", tags: { action: "wallet_pase_apple" } });
    return NextResponse.json({ ok: false }, { status: 500, headers: cabeceras });
  }

  try {
    const archivo = construirPaseApple({
      config: config.apple,
      snapshot: preparado.data.snapshot,
      serialNumber: preparado.data.pass.serial_number,
      authenticationToken: preparado.data.pass.authentication_token,
      siteUrl: config.siteUrl,
    });
    return new Response(new Uint8Array(archivo), {
      status: 200,
      headers: {
        ...cabeceras,
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": 'attachment; filename="vicino-lealtad.pkpass"',
      },
    });
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "wallet_pase_apple", paso: "firmar" } });
    return NextResponse.json({ ok: false, error: "no_se_pudo_generar" }, { status: 500, headers: cabeceras });
  }
}
