import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { conLealtad } from "@/types/loyalty.types";
import { configWallet } from "@/lib/wallet/config";
import { procesarTrabajosWallet } from "@/lib/wallet/sincronizar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Procesador de la outbox de Wallet (wallet_update_jobs). Vercel Cron lo
 * invoca cada 10 minutos (apps/web/vercel.json) con el mismo
 * `Authorization: Bearer ${CRON_SECRET}` que recompute-rankings. Tambien se
 * puede disparar a mano con POST. Sin credenciales de Wallet no hay nada que
 * sincronizar y responde 200 con cero trabajos.
 */
async function sincronizar(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const esperado = Buffer.from(`Bearer ${cronSecret}`);
  const recibido = Buffer.from(request.headers.get("authorization") ?? "");
  if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const config = configWallet();
  if (!config.apple && !config.google) {
    return NextResponse.json({ ok: true, omitido: "wallet_sin_credenciales", tomados: 0 });
  }
  try {
    const resumen = await procesarTrabajosWallet(conLealtad(createAdminClient()), config, 20);
    return NextResponse.json({ ok: resumen.fallidos === 0, ...resumen }, { status: resumen.fallidos === 0 ? 200 : 207 });
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "cron_wallet_sync" } });
    return NextResponse.json({ ok: false, error: fallo instanceof Error ? fallo.message : "fallo" }, { status: 500 });
  }
}

export const GET = sincronizar;
export const POST = sincronizar;
